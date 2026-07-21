// Unread aggregation for the account-menu badge. The backend inbox is paginated
// (limit ≤100) and covers BOTH open and closed inquiries when no status filter
// is supplied, so an accurate total must walk every unarchived page rather than
// summing only the first page.

export function sumUnreadCounts(
  inquiries: Array<{ unreadCount: number }>
): number {
  return inquiries.reduce((sum, item) => sum + item.unreadCount, 0);
}

/** Number of pages needed to cover `total` items at `limit` per page. */
export function totalPagesFor(total: number, limit: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  if (!Number.isFinite(limit) || limit <= 0) return 0;
  return Math.ceil(total / limit);
}

/**
 * Folds paged inbox results into a total. `complete` is false when the caller
 * could not read every page (error, or the page budget was exhausted) — the UI
 * must then keep the previous backend-derived badge instead of showing a
 * partial, invented number.
 */
export function aggregateUnread(
  pages: Array<Array<{ unreadCount: number }>>,
  complete: boolean
): { total: number; complete: boolean } {
  return {
    total: pages.reduce((sum, page) => sum + sumUnreadCounts(page), 0),
    complete,
  };
}
