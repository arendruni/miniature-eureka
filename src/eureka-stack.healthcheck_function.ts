import * as r53 from "@aws-sdk/client-route-53";
import { ALBResult, APIGatewayProxyEventV2 } from "aws-lambda";

const r53Client = new r53.Route53Client({});
const recordName = process.env.APP_RECORD_NAME;
const hostedZoneId = process.env.APP_HOSTEDZONE_ID;

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<ALBResult> => {
  try {
    const sourceIp = event.requestContext.http.sourceIp;

    const records = await r53Client.send(
      new r53.ListResourceRecordSetsCommand({ HostedZoneId: hostedZoneId }),
    );

    const record = records.ResourceRecordSets?.find(
      ({ Name }) => Name === `${recordName}.`,
    );

    if (!record) {
      throw { message: "record not found", error: records };
    } else if (!record.ResourceRecords) {
      throw {
        message: "record.ResourceRecords are undefined",
        error: record,
      };
    }

    if (!record.ResourceRecords.some(({ Value }) => Value === sourceIp)) {
      console.log("IP has changed");

      const response = await updateRecord(sourceIp);
      console.log(response);
    } else {
      console.log("IP has not changed", sourceIp, record.ResourceRecords);
    }

    return {
      statusCode: 200,
      statusDescription: "OK",
    };
  } catch (e) {
    console.error(e);

    return {
      statusCode: 500,
      statusDescription: "Internal server Error",
    };
  }
};

const updateRecord = (value: string) =>
  r53Client.send(
    new r53.ChangeResourceRecordSetsCommand({
      HostedZoneId: process.env.APP_HOSTEDZONE_ID,
      ChangeBatch: {
        Changes: [
          {
            Action: "UPSERT",
            ResourceRecordSet: {
              Name: process.env.APP_RECORD_NAME,
              Type: "A",
              ResourceRecords: [{ Value: value }],
              TTL: 300,
            },
          },
        ],
      },
    }),
  );
