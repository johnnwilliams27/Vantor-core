import { useMemo, useState, useDeferredValue, useCallback } from 'react';

type Accessor<T> = keyof T | ((item: T) => string);

interface DropdownConfig<T> {
  key: string;
  accessor: (item: T) => string;
}

interface SortConfig<T> {
  key: string;
  accessor: (item: T) => string | number;
  type?: 'string' | 'number' | 'date';
}

interface FilterConfig<T> {
  searchFields: Accessor<T>[];
  dropdowns?: DropdownConfig<T>[];
  dateField?: (item: T) => string | null | undefined;
  sortColumns?: SortConfig<T>[];
}

export type PageSize = 25 | 50;

export function useTableFilter<T>(data: T[] | undefined, config: FilterConfig<T>) {
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState<PageSize>(25);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const deferredSearch = useDeferredValue(search);

  const items = data ?? [];

  // Extract unique dropdown options from full dataset
  const dropdownOptions = useMemo(() => {
    const result: Record<string, string[]> = {};
    for (const dd of config.dropdowns ?? []) {
      const values = new Set<string>();
      for (const item of items) {
        const v = dd.accessor(item);
        if (v) values.add(v);
      }
      result[dd.key] = Array.from(values).sort();
    }
    return result;
  }, [items, config.dropdowns]);

  const filteredData = useMemo(() => {
    let result = items;

    // Text search
    const q = deferredSearch.toLowerCase().trim();
    if (q) {
      result = result.filter((item) =>
        config.searchFields.some((field) => {
          const val = typeof field === 'function' ? field(item) : String(item[field] ?? '');
          return val.toLowerCase().includes(q);
        })
      );
    }

    // Dropdown filters
    for (const dd of config.dropdowns ?? []) {
      const filterVal = filters[dd.key];
      if (filterVal && filterVal !== 'all') {
        result = result.filter((item) => dd.accessor(item) === filterVal);
      }
    }

    // Date range
    if (config.dateField && (dateFrom || dateTo)) {
      result = result.filter((item) => {
        const d = config.dateField!(item);
        if (!d) return false;
        const dateStr = d.slice(0, 10); // YYYY-MM-DD
        if (dateFrom && dateStr < dateFrom) return false;
        if (dateTo && dateStr > dateTo) return false;
        return true;
      });
    }

    return result;
  }, [items, deferredSearch, filters, dateFrom, dateTo, config]);

  // Sorting
  const toggleSort = useCallback((key: string) => {
    if (sortKey === key) {
      setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
    setPage(1);
  }, [sortKey]);

  const sortedData = useMemo(() => {
    if (!sortKey || !config.sortColumns) return filteredData;
    const col = config.sortColumns.find((c) => c.key === sortKey);
    if (!col) return filteredData;
    return [...filteredData].sort((a, b) => {
      const aVal = col.accessor(a);
      const bVal = col.accessor(b);
      let cmp = 0;
      if (col.type === 'date') {
        cmp = new Date(aVal as string).getTime() - new Date(bVal as string).getTime();
      } else if (col.type === 'number') {
        cmp = Number(aVal) - Number(bVal);
      } else {
        cmp = String(aVal).localeCompare(String(bVal));
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filteredData, sortKey, sortDir, config.sortColumns]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(sortedData.length / pageSize));
  const safePage = Math.min(page, totalPages);

  const pagedData = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return sortedData.slice(start, start + pageSize);
  }, [sortedData, safePage, pageSize]);

  // Reset to page 1 when filters change
  const setSearchWrapped = useCallback((v: string) => { setSearch(v); setPage(1); }, []);
  const setDateFromWrapped = useCallback((v: string) => { setDateFrom(v); setPage(1); }, []);
  const setDateToWrapped = useCallback((v: string) => { setDateTo(v); setPage(1); }, []);
  const setFilterWrapped = useCallback((key: string, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  }, []);

  const setPageSize = useCallback((size: PageSize) => {
    setPageSizeState(size);
    setPage(1);
  }, []);

  const activeFilterCount =
    (deferredSearch.trim() ? 1 : 0) +
    Object.values(filters).filter((v) => v && v !== 'all').length +
    (dateFrom ? 1 : 0) +
    (dateTo ? 1 : 0);

  const clearAll = useCallback(() => {
    setSearch('');
    setFilters({});
    setDateFrom('');
    setDateTo('');
    setPage(1);
  }, []);

  return {
    filteredData,
    pagedData,
    search,
    setSearch: setSearchWrapped,
    filters,
    setFilter: setFilterWrapped,
    dateFrom,
    setDateFrom: setDateFromWrapped,
    dateTo,
    setDateTo: setDateToWrapped,
    dropdownOptions,
    activeFilterCount,
    clearAll,
    totalCount: items.length,
    // Sorting
    sortKey,
    sortDir,
    toggleSort,
    // Pagination
    page: safePage,
    setPage,
    pageSize,
    setPageSize,
    totalPages,
    filteredCount: sortedData.length,
  };
}
