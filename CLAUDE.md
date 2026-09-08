# Claude Instructions

Follow `AGENTS.md`. Important reminders:

- This is a **product**, deployed for more than one company. Nothing
  company-specific belongs anywhere except `deployments/<name>.json`.
- Never hardcode an account id, region, domain, prefix or brand string. If a
  value can be derived, derive it in `scripts/profile.mjs`.
- One deployment per AWS account — see `docs/architecture.md` for why.
- Raw CloudFormation, no SAM or CDK.
- Never commit secrets. The Google client secret lives in SSM.
