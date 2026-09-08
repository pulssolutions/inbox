# Cost

Design for near-zero idle cost. A quiet deployment should cost a few dollars a
month, dominated by the Route 53 hosted zone if you use one.

Allowed by default:

- Lambda
- API Gateway HTTP API
- DynamoDB on-demand
- S3
- CloudFront `PriceClass_100`
- Cognito for a small agent user base
- SES (about $0.10 per 1,000 messages in or out)
- CloudWatch Logs, always with retention set

Ask before adding anything with a standing charge:

- NAT Gateway
- RDS or Aurora
- OpenSearch
- ECS, EKS, or always-on EC2
- WAF
- Kinesis
- Provisioned DynamoDB capacity
- Paid third-party services

The `billing` stack adds a budget alarm to the profile's `notificationEmail`,
with the threshold from `ops.monthlyBudget`.

## Where cost would actually grow

Search and thread assembly scan the org's whole message partition, so read cost
is linear in total ticket count rather than in results. Fine at low volume; the
first thing to fix if a deployment gets busy.
