import { getProjectCost } from '../api/projects';

// PUBLIC_INTERFACE
export async function devTryProjectCost(projectId) {
  /** Convenience dev helper to quickly test the project cost endpoint from the console. */
  const pid = projectId ?? '21566';
  const data = await getProjectCost(pid);
  // eslint-disable-next-line no-console
  console.log('[devTryProjectCost]', pid, data);
  return data;
}

// PUBLIC_INTERFACE
export async function devTrySampleProjectCosts() {
  /** Test both sample IDs: 21566 and 20684. */
  const ids = ['21566', '20684'];
  const results = [];
  for (const id of ids) {
    // eslint-disable-next-line no-await-in-loop
    const data = await getProjectCost(id);
    results.push({ id, ...data });
  }
  // eslint-disable-next-line no-console
  console.table(results);
  return results;
}
