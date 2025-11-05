 /**
  * PUBLIC_INTERFACE
  * devTryProjectCost
  * Dev-only helper used in local development to simulate project cost history.
  * This function is disabled in production builds and will throw if invoked.
  */
export default async function devTryProjectCost(projectId) {
  if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'production') {
    throw new Error('devTryProjectCost is disabled in production.');
  }
  await new Promise((r) => setTimeout(r, 300));
  return {
    projectId: projectId ?? 'demo',
    history: [
      { date: '2024-10-01', total: 10 },
      { date: '2024-10-02', total: 14 },
      { date: '2024-10-03', total: 7 },
    ],
  };
}
