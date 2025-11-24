UserMiniInsights integration notes

- Purpose: Show mini charts in the User Details popup with per-user project timeline and categories.
- Usage example inside TabbedUserModal details tab:
  import { UserMiniInsights } from "../../modules/users";

  const from = new Date(Date.now() - 30*24*60*60*1000).toISOString();
  const to = new Date().toISOString().replace(/:\\d{2}\\.\\d+Z$/, ":59.999Z");

  <UserMiniInsights userId={user?._id} tenantId={tenantId} from={from} to={to} />

- The component is self-contained and uses useUserProjects hook. It provides loading and error states and accessible chart titles.
