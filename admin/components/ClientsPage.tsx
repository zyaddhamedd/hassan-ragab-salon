import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Download, RefreshCw, Search, ServerCrash, Users } from 'lucide-react';
import ClientTable from './ClientTable.tsx';
import ClientDetailsModal from './ClientDetailsModal.tsx';
import ClientsExportModal, { ClientsExportColumnOption } from './clients/ClientsExportModal.tsx';
import adminApi from '../api/client';
import { Client } from '../types';
import { downloadBlob, getFilenameFromContentDisposition } from '../utils/fileDownload';
import { getTodayISO } from '../utils/dateFormatter';

interface ClientsPageProps {
  isDarkMode: boolean;
  selectedBranch: string;
}

const PAGE_SIZE = 50;

const CLIENT_EXPORT_COLUMNS: ClientsExportColumnOption[] = [
  { id: 'name', label: 'Name' },
  { id: 'phone', label: 'Phone' },
  { id: 'visits_count', label: 'Visits' },
  { id: 'total_spending', label: 'Total Spend' },
  { id: 'last_barber', label: 'Last Barber' },
  { id: 'last_visit_date', label: 'Last Visit' },
  { id: 'branch', label: 'Branch' },
  { id: 'customer_since', label: 'Customer Since' }
];

const DEFAULT_CLIENT_EXPORT_COLUMN_IDS = CLIENT_EXPORT_COLUMNS.map((column) => column.id);

const buildBranchParam = (selectedBranch: string) => (
  selectedBranch === 'All' ? 'all' : selectedBranch
);

const parseExportErrorMessage = async (error: any): Promise<string> => {
  const responseData = error?.response?.data;

  if (responseData instanceof Blob) {
    try {
      const text = await responseData.text();
      if (!text) {
        return 'Failed to export clients. Please try again.';
      }

      try {
        const parsed = JSON.parse(text);
        return parsed.error || parsed.message || parsed.details || 'Failed to export clients. Please try again.';
      } catch {
        return text;
      }
    } catch {
      return 'Failed to export clients. Please try again.';
    }
  }

  return error?.response?.data?.error || error?.response?.data?.message || error?.message || 'Failed to export clients. Please try again.';
};

const ClientsPage: React.FC<ClientsPageProps> = ({ isDarkMode, selectedBranch }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [onlyStarred] = useState(false);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportToast, setExportToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // API State
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const requestSeqRef = useRef(0);
  const latestRequestKeyRef = useRef('');

  const fetchClients = async (
    page: number = 1,
    append: boolean = false,
    searchValue: string = debouncedSearchQuery
  ) => {
    const branchParam = buildBranchParam(selectedBranch);
    const normalizedSearch = searchValue.trim();
    const requestSeq = ++requestSeqRef.current;
    const requestKey = `${branchParam}|${normalizedSearch}|${page}|${append ? 'append' : 'replace'}`;
    latestRequestKeyRef.current = requestKey;

    if (append) {
      setIsLoadingMore(true);
    } else {
      setIsLoading(true);
    }
    setError(null);

    try {
      const response = await adminApi.get('/customers', {
        params: {
          branch_id: branchParam,
          search: normalizedSearch || undefined,
          page,
          per_page: PAGE_SIZE
        }
      });

      if (requestSeq !== requestSeqRef.current || latestRequestKeyRef.current !== requestKey) {
        return;
      }

      const mappedClients: Client[] = (response.data.items || []).map((clientRecord: any) => ({
        id: clientRecord.id.toString(),
        name: clientRecord.full_name,
        phone: clientRecord.phone,
        visits: clientRecord.visits_count,
        totalSpend: clientRecord.total_spend,
        lastVisit: clientRecord.last_visit || 'بلا زيارات',
        primaryBranch: clientRecord.branch,
        lastBarberName: clientRecord.last_barber_name || null,
        last_barber_name: clientRecord.last_barber_name || null,
        customerSince: clientRecord.customer_since || null,
        depositBalance: clientRecord.deposit_balance || 0,
        starredBranches: [], // Not implemented yet
        avatarColor: '#E53935'
      }));

      setClients((previousClients) => append ? [...previousClients, ...mappedClients] : mappedClients);
      setCurrentPage(response.data.current_page || page);
      setTotalPages(response.data.pages || 1);
      setTotalCount(response.data.total || 0);
      setHasLoadedOnce(true);
    } catch (err: any) {
      if (requestSeq !== requestSeqRef.current || latestRequestKeyRef.current !== requestKey) {
        return;
      }

      console.error('Failed to fetch clients:', err);
      setError(err.response?.status === 404
        ? 'Backend Endpoint Missing: GET /api/admin/customers'
        : err.message || 'Failed to load clients');
      if (!append) {
        setClients([]);
      }
    } finally {
      if (requestSeq !== requestSeqRef.current || latestRequestKeyRef.current !== requestKey) {
        return;
      }

      setIsLoading(false);
      setIsLoadingMore(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 400);

    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    fetchClients(1, false, debouncedSearchQuery);
  }, [selectedBranch, debouncedSearchQuery]);

  useEffect(() => {
    if (!exportToast) {
      return;
    }

    const timeout = window.setTimeout(() => setExportToast(null), 2800);
    return () => window.clearTimeout(timeout);
  }, [exportToast]);

  const filteredClients = useMemo(() => {
    return clients.filter((client) => {
      const matchesSearch = client.name.toLowerCase().includes(debouncedSearchQuery.toLowerCase()) ||
        client.phone.includes(debouncedSearchQuery);

      const matchesStarred = onlyStarred ? client.starredBranches.length > 0 : true;
      return matchesSearch && matchesStarred;
    });
  }, [debouncedSearchQuery, onlyStarred, clients]);

  const matchingClientsCount = onlyStarred ? filteredClients.length : totalCount;
  const isRefreshingFilters = isLoading && hasLoadedOnce;
  const isExportDisabled = isExporting || isRefreshingFilters || !hasLoadedOnce;

  const handleToggleStar = async (_client: Client) => {
    alert('Backend Endpoint Required: POST /api/admin/clients/:id/star');
  };

  const handleLoadMore = () => {
    if (isLoadingMore || currentPage >= totalPages) {
      return;
    }

    fetchClients(currentPage + 1, true);
  };

  const handleExportClients = async (selectedColumnIds: string[]) => {
    if (isExporting) {
      return;
    }

    setIsExporting(true);

    try {
      const response = await adminApi.post(
        '/customers/export/xlsx',
        {
          branch_id: buildBranchParam(selectedBranch),
          search: debouncedSearchQuery.trim() || undefined,
          starred_only: onlyStarred,
          columns: selectedColumnIds
        },
        {
          responseType: 'blob'
        }
      );

      const filename = getFilenameFromContentDisposition(response.headers['content-disposition']) || `Clients_${getTodayISO()}.xlsx`;
      const blob = response.data instanceof Blob ? response.data : new Blob([response.data]);

      downloadBlob(blob, filename);
      setIsExportModalOpen(false);
      setExportToast({ type: 'success', message: 'Client export started. Your Excel file is downloading.' });
    } catch (err: any) {
      console.error('Failed to export clients:', err);
      setExportToast({ type: 'error', message: await parseExportErrorMessage(err) });
    } finally {
      setIsExporting(false);
    }
  };

  if (error) {
    return (
      <div className="admin-page-shell animate-fade-in-up">
        <div className={`p-12 rounded-[3rem] border-2 border-dashed flex flex-col items-center justify-center text-center gap-6 ${isDarkMode ? 'border-red-500/20 bg-red-500/5' : 'border-red-500/20 bg-red-50'}`}>
          <div className="w-20 h-20 bg-red-500/10 text-red-500 rounded-full flex items-center justify-center">
            <ServerCrash size={32} />
          </div>
          <div className="max-w-md">
            <h2 className={`text-2xl font-bold mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Backend Connection Failed</h2>
            <p className={`font-mono text-sm opacity-70 mb-6 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              {error}
            </p>
            <div className="flex justify-center gap-3">
              <button
                onClick={() => fetchClients()}
                className="px-6 py-3 rounded-xl bg-[#E53935] text-white font-bold text-xs uppercase tracking-widest flex items-center gap-2 hover:bg-[#FF3B30] transition-colors"
              >
                <RefreshCw size={14} />
                Retry Connection
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (isLoading && !hasLoadedOnce) {
    return (
      <div className="admin-page-shell admin-page-state flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 opacity-50">
          <RefreshCw size={32} className="animate-spin text-[#E53935]" />
          <span className="text-xs font-bold uppercase tracking-widest">Loading Clients from Backend...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-page-shell space-y-12 animate-fade-in-up">
      <div className="max-w-5xl mx-auto w-full space-y-4">
        <div className="flex flex-col xl:flex-row items-stretch xl:items-center gap-4">
          <div className="relative group flex-1">
            <div className={`absolute right-6 top-1/2 -translate-y-1/2 transition-all group-focus-within:scale-110 ${isDarkMode ? 'text-gray-500 group-focus-within:text-[#E53935]' : 'text-gray-400 group-focus-within:text-[#E53935]'}`}>
              <Search size={22} />
            </div>
            <input
              type="text"
              placeholder="ابحث عن عميل..."
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className={`w-full px-16 py-6 rounded-[2rem] border text-lg font-bold outline-none transition-all shadow-2xl shadow-black/5 ${isDarkMode
                ? 'bg-[#161616] border-white/5 text-white focus:border-[#E53935]/40 focus:bg-black/40'
                : 'bg-white border-black/5 text-gray-900 focus:border-[#E53935]/40 shadow-sm'
                }`}
            />
            {isRefreshingFilters && (
              <div className={`absolute left-6 top-1/2 -translate-y-1/2 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                <RefreshCw size={18} className="animate-spin text-[#E53935]" />
              </div>
            )}
          </div>

          <button
            onClick={() => setIsExportModalOpen(true)}
            disabled={isExportDisabled}
            className={`min-w-[200px] rounded-[2rem] border px-6 py-5 text-[10px] font-bold uppercase tracking-[0.3em] transition-all flex items-center justify-center gap-3 disabled:cursor-not-allowed disabled:opacity-60 ${isDarkMode ? 'bg-[#161616] border-white/10 text-white hover:bg-white/10' : 'bg-white border-black/5 text-gray-900 hover:bg-gray-50 shadow-sm'}`}
          >
            {isExporting ? (
              <>
                <RefreshCw size={16} className="animate-spin" />
                Preparing...
              </>
            ) : (
              <>
                <Download size={16} />
                Export
              </>
            )}
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 px-2">
          <div className="flex items-center gap-2">
            <span className={`text-[10px] font-bold uppercase tracking-[0.3em] ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              {matchingClientsCount.toLocaleString('en-US')} Matching Clients
            </span>
            {selectedBranch !== 'All' && (
              <span className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.25em] ${isDarkMode ? 'bg-white/5 text-gray-300' : 'bg-white text-gray-600 shadow-sm'}`}>
                Branch #{selectedBranch}
              </span>
            )}
          </div>

          {isLoadingMore && (
            <span className={`text-[10px] font-bold uppercase tracking-[0.25em] ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
              Loading more...
            </span>
          )}
        </div>
      </div>

      {filteredClients.length > 0 ? (
        <div className="space-y-5">
          <ClientTable
            clients={filteredClients}
            isDarkMode={isDarkMode}
            onViewDetails={(client) => setSelectedClient(client)}
            onToggleStar={handleToggleStar}
            selectedBranch={selectedBranch}
          />

          {currentPage < totalPages && (
            <div className="flex justify-center">
              <button
                onClick={handleLoadMore}
                disabled={isLoadingMore}
                className={`min-w-[220px] px-6 py-3 rounded-2xl border text-[10px] font-bold uppercase tracking-[0.3em] flex items-center justify-center gap-2 transition-all disabled:opacity-60 disabled:cursor-not-allowed ${isDarkMode ? 'bg-white/5 border-white/10 text-white hover:bg-white/10' : 'bg-white border-black/5 text-gray-900 hover:bg-gray-50 shadow-sm'}`}
              >
                {isLoadingMore ? (
                  <>
                    <RefreshCw size={14} className="animate-spin" />
                    جاري التحميل...
                  </>
                ) : (
                  <>
                    <RefreshCw size={14} />
                    Load More ({currentPage}/{totalPages})
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className={`py-32 text-center rounded-[3rem] border theme-transition ${isDarkMode ? 'bg-[#161616] border-white/5' : 'bg-white border-black/5'}`}>
          <Users size={48} className="mx-auto mb-4 opacity-20" />
          <p className="text-sm font-bold opacity-40">لا توجد سجلات مطابقة حالياً</p>
        </div>
      )}

      {selectedClient && (
        <ClientDetailsModal
          client={selectedClient}
          isDarkMode={isDarkMode}
          selectedBranch={selectedBranch}
          onClose={() => setSelectedClient(null)}
          onToggleStar={handleToggleStar}
        />
      )}

      <ClientsExportModal
        isOpen={isExportModalOpen}
        isDarkMode={isDarkMode}
        matchingCount={matchingClientsCount}
        columns={CLIENT_EXPORT_COLUMNS}
        defaultSelectedColumnIds={DEFAULT_CLIENT_EXPORT_COLUMN_IDS}
        isSubmitting={isExporting}
        onClose={() => setIsExportModalOpen(false)}
        onConfirm={handleExportClients}
      />

      {exportToast && (
        <div className="fixed bottom-8 left-8 z-[160] animate-toast-in">
          <div className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-[11px] font-black shadow-2xl ${exportToast.type === 'success'
            ? isDarkMode
              ? 'border-emerald-500/25 bg-[#101917] text-emerald-300'
              : 'border-emerald-100 bg-white text-emerald-700'
            : isDarkMode
              ? 'border-red-500/25 bg-[#1A1111] text-red-300'
              : 'border-red-100 bg-white text-red-600'
            }`}
          >
            {exportToast.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
            <span>{exportToast.message}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default ClientsPage;
