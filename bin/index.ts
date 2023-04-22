import * as cdk from "aws-cdk-lib";
import { EurekaStack } from "../src/eureka-stack";
import dotenv from "dotenv-flow";

dotenv.config();

const app = new cdk.App();

new EurekaStack(app, "EurekaApp", {
  recordName: process.env.RECORD_NAME ?? "",
  hostedZone: {
    hostedZoneId: process.env.HOSTED_ZONE_ID ?? "",
    zoneName: process.env.ZONE_NAME ?? "",
  },
  snsEmail: process.env.SNS_EMAIL ?? "",
  env: { region: process.env.REGION ?? process.env.AWS_REGION },
});
