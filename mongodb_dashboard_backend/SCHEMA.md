# MongoDB Schema Reference

Source: attachments/20250929_050449_Dashboard_Data_Fields.xlsx

Environments (from sheet notes):
- Develop: develop_kaviaroot
- QA: qa_kaviaroot
- Beta/Preprod: pre_prod__kaviaroot

Legend
- → indicates a field inside an object
- → → indicates a field nested two levels deep

---

## 1) Referral dashboard

- Database: develop_kaviaroot / qa_kaviaroot / pre_prod__kaviaroot (per environment)
- Collection: users

Fields (top-level unless indented):

- referral_code: string
  - Description: Used to onboard users through referrals.

- referral_stats: array<object> | object
  - Description: List of objects containing referral statistics.
  - → total_referrals: number
    - Description: Number of users onboarded based on the referral code.
  - → verified_referrals: number
    - Description: Number of users who have been verified.
  - → last_referral_date: date or string (ISO date)
    - Description: The most recent date a referral occurred.

- referral_history: array<object>
  - Description: List of referral history objects containing detailed referral data.
  - Each item:
    - → user_id: string | ObjectId
      - Description: Unique identifier of the referred user.
    - → user_email: string (email)
      - Description: Email address of the referred user.
    - → user_name: string
      - Description: Name of the referred user.
    - → referred_at: date or string (ISO date)
      - Description: Timestamp when the referral occurred.
    - → verified_at: date or string (ISO date) | null
      - Description: Timestamp when the referral was verified.
    - → status: string (enum: pending, verified, etc.)
      - Description: Status of the referral.

Suggested Indexes:
- users: { referral_code: 1 }
- users: { "referral_history.user_id": 1 }
- users: { "referral_history.status": 1, "referral_history.referred_at": -1 }

---

## 2) Session dashboard

- Database: develop_kaviaroot / qa_kaviaroot / pre_prod__kaviaroot
- Collection: session_tracking

Fields:

- task_id: string
  - Description: Has the value of the particular task which is present.
- tenant_id: string
  - Description: The organization this session belongs to.
- organization_name: string
  - Description: Name of the organization.
- user_id: string | ObjectId
  - Description: Unique identifier of the user.
- User_name: string
  - Description: Name of the user who performs the session.
  - Note: Consider normalizing to user_name (lower camel/snake case) for consistency.
- project_id: string
  - Description: The project ID associated with the session.
- container_id: string
  - Description: Value indicating if the session belongs to code generation or code maintenance.
- service_type: string (enum)
  - Description: Type of service, e.g., code generation, code query, deep query, interactive configuration, auto configuration, or code maintenance.
- session_start: date or string (ISO date)
  - Description: Timestamp when the session started.
- session_end: date or string (ISO date) | null
  - Description: Timestamp when the session ended.
- status: string (enum: active, completed, failed)
  - Description: Status of the session.
- total_cost: number
  - Description: Sum of all agent costs.
- agent_costs: object
  - Description: Object containing a list/map of agents and their respective costs.
- cost_history: array<object>
  - Description: Various agent costs and total costs for particular durations.
  - Each item:
    - → timestamp: date or string (ISO date)
      - Description: Timestamp for this cost entry.
    - → agent_costs: object
      - Description: Costs for each agent at this timestamp.
    - → total_cost: number
      - Description: Total cost for this timestamp.
- last_updated: date or string (ISO date)
  - Description: Timestamp of the last update for this session.
- session_data: object
  - Description: Object containing session-specific data.
  - → llm_model: string
    - Description: Name of the LLM model currently used in this session.
  - → session_name: string
    - Description: Name of the particular session.
  - → description: string
    - Description: Description for the particular session.
  - → platform: string
    - Description: Which platform is used (e.g., web).
  - → selected_repos: object
    - Description: List of repositories used in code maintenance.
    - → → all_repositories: boolean
      - Description: true if all repositories are selected; false if specific repositories are selected.
    - → → repositories: array<string>
      - Description: IDs of selected repositories if all_repositories is false.
- created_at: date or string (ISO date)
  - Description: Timestamp when the session was created.

Suggested Indexes:
- session_tracking: { tenant_id: 1, status: 1, session_start: -1 }
- session_tracking: { user_id: 1, session_start: -1 }
- session_tracking: { project_id: 1, service_type: 1 }
- session_tracking: { task_id: 1 }
- session_tracking: { last_updated: -1 }

Notes:
- Ensure numeric fields (total_cost) are stored as numbers/decimals as needed.
- Consider Time-To-Live (TTL) on ephemeral sessions depending on product requirements.

---

## 3) Deployment dashboard

- Database: develop_kaviaroot / qa_kaviaroot / pre_prod__kaviaroot
- Collection: app_deployments

Fields:

- app_id: string
  - Description: Unique identifier for the deployed application.
- app_url: string (URL)
  - Description: Publicly accessible URL of the deployed application.
- artifact_path: string
  - Description: Storage path or location of the deployment artifacts (e.g., build files, images).
- branch_name: string
  - Description: The Git branch from which the deployment was created.
- build_path: string
  - Description: Path to the build directory containing compiled application files.
- command: string
  - Description: Build command executed for deployment (e.g., npm run build).
- created_at: date or string (ISO date)
  - Description: Timestamp when the deployment was created.
- custom_domain: string | null
  - Description: Custom domain mapped to the deployed application, if configured.
- deployment_id: string
  - Description: Unique identifier for the deployment instance.
- job_id: string
  - Description: Identifier of the deployment job or process execution.
- message: string
  - Description: Additional message or notes related to the deployment.
- project_id: string
  - Description: Project id associated with the deployment.
- project_name: string
  - Description: Name of the project associated with the deployment.
- root_path: string
  - Description: Root directory path from which the deployment files are served.
- status: string (enum: success, failed, in-progress)
  - Description: Current status of the deployment.
- subdomain: string
  - Description: Auto-generated subdomain assigned to the deployment.
- task_id: string
  - Description: Particular task where the deployment happened for the project.
- tenant_id: string
  - Description: Organization id associated with the deployment.
- tenant_name: string
  - Description: Organization name associated with the deployment.
- updated_at: date or string (ISO date)
  - Description: Timestamp of the most recent update to the deployment.
- artifact_count: number
  - Description: Number of artifacts generated or uploaded during deployment.
- domain_status: string (enum: verified, pending, failed)
  - Description: Status of the custom domain.
- domain_checked_at: date or string (ISO date) | null
  - Description: Timestamp when the custom domain was last verified or checked.

Suggested Indexes:
- app_deployments: { project_id: 1, created_at: -1 }
- app_deployments: { tenant_id: 1, status: 1, updated_at: -1 }
- app_deployments: { deployment_id: 1 } UNIQUE
- app_deployments: { app_id: 1, updated_at: -1 }
- app_deployments: { custom_domain: 1 } PARTIAL (custom_domain exists)
- app_deployments: { branch_name: 1, created_at: -1 }

Notes:
- Validate URLs and domain fields.
- Consider separate collection for artifacts if volume is high.

---

## 4) Pod dashboard

- Note: For the Pod dashboard, there is no MongoDB collection since it is maintained directly through the Kubernetes API.

---

## Cross-cutting Recommendations

- Timestamps: Use ISO 8601 strings or MongoDB Date type consistently; consider storing as Date for querying by time.
- IDs: Where applicable, store as ObjectId references to related entities; otherwise store normalized string IDs and document relationships.
- Validation: Define JSON schema or Mongoose models to enforce field types and constraints.
- Auditing: Include created_at, updated_at, and last_updated where appropriate; consider a change history or event log for critical actions.
- Data hygiene: Normalize field names to lower_snake_case or lowerCamelCase consistently (e.g., prefer user_name over User_name).
- Security: Avoid storing PII without encryption or masking; consider field-level encryption for sensitive fields (emails).
- Performance: Index fields used for filtering/sorting; monitor index size and query patterns.

---
