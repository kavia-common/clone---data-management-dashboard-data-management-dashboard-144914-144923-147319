 /**
  * PUBLIC_INTERFACE
  * buildOverviewFilterParams
  * Maps shared overview filters to { from, to } window.
  * - day: last 30 days
  * - week: last 12 weeks
  * - month: last 12 months
  * - custom: use provided dateStart/dateEnd
  */
export function buildOverviewFilterParams({ rangeType, dateStart, dateEnd } = {}) {
  const now = new Date();
  const to = now.toISOString();
  let from;

  switch ((rangeType || 'day').toLowerCase()) {
    case 'week': {
      const d = new Date(now);
      d.setDate(d.getDate() - 12 * 7);
      from = d.toISOString();
      break;
    }
    case 'month': {
      const d = new Date(now);
      d.setMonth(d.getMonth() - 12);
      from = d.toISOString();
      break;
    }
    case 'custom': {
      const out = {};
      if (dateStart) out.from = new Date(dateStart).toISOString();
      if (dateEnd) out.to = new Date(dateEnd).toISOString();
      return out;
    }
    case 'day':
    default: {
      const d = new Date(now);
      d.setDate(d.getDate() - 30);
      from = d.toISOString();
    }
  }

  return { from, to };
}

export default buildOverviewFilterParams;
