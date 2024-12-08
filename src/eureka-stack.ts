import {
  CfnOutput,
  Duration,
  Stack,
  StackProps,
  aws_cloudwatch as cw,
  aws_cloudwatch_actions as cwa,
  aws_iam as iam,
  aws_lambda_nodejs as lambda,
  aws_route53 as r53,
  aws_sns as sns,
  aws_sns_subscriptions as snss,
} from "aws-cdk-lib";
import { FunctionUrlAuthType, Runtime } from "aws-cdk-lib/aws-lambda";
import { Statement } from "cdk-iam-floyd";
import { Construct } from "constructs";

interface EurekaStackProps extends StackProps {
  /**
   * Record name to be created and the updated from the lambda
   */
  recordName: string;

  /**
   * Route53 hosted zone attributes
   */
  hostedZone: r53.HostedZoneAttributes;

  /**
   * Email address that will receive the cloudwatch alarms notifications
   */
  snsEmail: string;

  /**
   * Lambda invocation scheduled cron period in seconds (Lambda is called every
   * `lambdaInvocationPeriod` seconds). This is needed in order to trigger the
   * missing data alarm
   *
   * @default Duration.minutes(30).toSeconds()
   */
  lambdaInvocationPeriod?: number;
}

export class EurekaStack extends Stack {
  constructor(
    scope: Construct,
    id: string,
    {
      recordName,
      hostedZone,
      snsEmail,
      lambdaInvocationPeriod = Duration.minutes(30).toSeconds(),
      ...props
    }: EurekaStackProps,
  ) {
    super(scope, id, props);

    new r53.ARecord(this, "healthcheck_domain", {
      target: r53.RecordTarget.fromValues("0.0.0.0"),
      zone: r53.HostedZone.fromHostedZoneAttributes(
        this,
        "root_hosted_zone",
        hostedZone,
      ),
      ttl: Duration.minutes(5),
      recordName,
    });

    // create lambda function
    const fn = new lambda.NodejsFunction(this, "healthcheck_function", {
      timeout: Duration.seconds(30),
      runtime: Runtime.NODEJS_18_X,
      environment: {
        APP_RECORD_NAME: recordName,
        APP_HOSTEDZONE_ID: hostedZone.hostedZoneId,
      },
    });

    // give lambda permission to update r53 record
    fn.addToRolePolicy(
      new Statement.Route53()
        .toListResourceRecordSets()
        .toChangeResourceRecordSets()
        .onHostedzone(hostedZone.hostedZoneId),
    );

    // create an alarm for lambda invocations
    const invocationsAlarm = fn
      // NOTE: missing data will be triggered after three evaluation period, so the
      // `period` prop should be set to 1/3 of lambda invocation cron
      .metricInvocations({
        period: Duration.seconds(Math.trunc(lambdaInvocationPeriod / 3)),
      })
      .createAlarm(this, "lambda_invocations_alarm", {
        evaluationPeriods: 1,
        threshold: 1,
        comparisonOperator: cw.ComparisonOperator.LESS_THAN_THRESHOLD,
        treatMissingData: cw.TreatMissingData.BREACHING,
      });

    // lambda errors alarm
    const errorsAlarm = fn
      .metricErrors({ period: Duration.seconds(lambdaInvocationPeriod) })
      .createAlarm(this, "lambda_errors", {
        evaluationPeriods: 1,
        threshold: 0,
        comparisonOperator: cw.ComparisonOperator.GREATER_THAN_THRESHOLD,
      });

    // create alarm topic and subscribe email to receive updates
    const alarmTopic = new sns.Topic(this, "healthcheck_alarm_topic");
    alarmTopic.addSubscription(new snss.EmailSubscription(snsEmail));
    const snsAlarmAction = new cwa.SnsAction(alarmTopic);

    invocationsAlarm.addAlarmAction(snsAlarmAction);
    invocationsAlarm.addOkAction(snsAlarmAction);
    errorsAlarm.addAlarmAction(snsAlarmAction);
    errorsAlarm.addOkAction(snsAlarmAction);

    // create lambda function url
    const fnUrl = fn.addFunctionUrl({ authType: FunctionUrlAuthType.AWS_IAM });

    // create user that will invoke the lambda
    const invokeUser = new iam.User(this, "lambda-invoke-user");

    const invokeFnStatement = new Statement.Lambda()
      .allow()
      .toInvokeFunctionUrl()
      .ifFunctionUrlAuthType(FunctionUrlAuthType.AWS_IAM);
    invokeFnStatement.addResources(fnUrl.functionArn);
    invokeFnStatement.freeze();

    const invokeFnPolicy = new iam.Policy(this, "lambda_invoke_policy", {
      statements: [invokeFnStatement],
    });
    invokeUser.attachInlinePolicy(invokeFnPolicy);

    // output the user in cloudformation's exports
    new CfnOutput(this, "lambda_invoke_user_export", {
      value: invokeUser.userArn,
      exportName: `${this.stackName}-lambda-invoke-user`,
    });
  }
}
