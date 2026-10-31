// Page-based pagination used by every list endpoint.
export type Pagination = { page: number; perPage: number; skip: number; take: number };

export function parsePagination(searchParams: URLSearchParams, perPage = 25): Pagination {
  const raw = Number(searchParams.get("page") ?? 1);
  const page = Number.isInteger(raw) && raw > 0 ? raw : 1;
  return { page, perPage, skip: (page - 1) * perPage, take: perPage };
}

export function buildMeta(total: number, pagination: Pagination) {
  const lastPage = Math.max(1, Math.ceil(total / pagination.perPage));
  return {
    current_page: pagination.page,
    last_page: lastPage,
    total,
    per_page: pagination.perPage,
  };
}

export function buildLinks(req: Request, pagination: Pagination, total: number) {
  const lastPage = Math.max(1, Math.ceil(total / pagination.perPage));
  const make = (page: number) => {
    const url = new URL(req.url);
    url.searchParams.set("page", String(page));
    return url.toString();
  };
  return {
    next: pagination.page < lastPage ? make(pagination.page + 1) : null,
    prev: pagination.page > 1 ? make(pagination.page - 1) : null,
  };
}
