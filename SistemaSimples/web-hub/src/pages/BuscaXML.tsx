import React, { useEffect, useState, useCallback, useRef } from 'react';
import api from '../services/api';
import { 
  Search, RefreshCw, Download, ChevronLeft, 
  ChevronRight, Clock, CheckCircle2, AlertCircle, Calendar, 
  X, ChevronDown, AlertTriangle, Filter, ChevronUp, ChevronsUpDown, Loader2,
  FileSpreadsheet, FolderDown
} from 'lucide-react';

// --- IMPORTAÇÕES DO DATEPICKER ---
import DatePicker, { registerLocale } from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { ptBR } from "date-fns/locale"; 

// Registra o idioma português no componente
registerLocale("pt-BR", ptBR);
// ---------------------------------

interface Task {
  cliente_cod: number;
  cnpj: string;
  empresa: string;
  mesano: string;
  status: string;
  username: string;
  created_at: string;
  error_msg?: string;
  save_path?: string;
  cert_status?: string;   
  cert_validade?: string;
  tipo?: string;
}

interface Cliente {
  cod: number;
  empresa: string;
  cnpj: string;
  ativo?: boolean;
}

type SortConfig = {
  key: keyof Task;
  direction: 'asc' | 'desc';
} | null;

export const BuscaXML: React.FC = () => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  
  // Estados do Agendamento Manual (Download Físico)
  const [selectedClientes, setSelectedClientes] = useState<Cliente[]>([]);
  const [clienteSearch, setClienteSearch] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Estados da Exportação Analítica
  const [selectedClienteExport, setSelectedClienteExport] = useState<Cliente | null>(null);
  const [clienteExportSearch, setClienteExportSearch] = useState('');
  const [dropdownExportOpen, setDropdownExportOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const dropdownExportRef = useRef<HTMLDivElement>(null);
  const [mesExport, setMesExport] = useState(() => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });

  const [buscaTabela, setBuscaTabela] = useState('');
  const [statusFiltro, setStatusFiltro] = useState('todos');
  const [sortConfig, setSortConfig] = useState<SortConfig>(null);
  
  const [mesFiltro, setMesFiltro] = useState(() => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  
  const [tipoBusca, setTipoBusca] = useState<'emitidas' | 'tomadas'>('emitidas');
  
  const [mesAgendamento, setMesAgendamento] = useState(() => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  
  const [loading, setLoading] = useState(true);
  const [paginaAtual, setPaginaAtual] = useState(1);
  const itensPorPagina = 10;

  const [feedbackModal, setFeedbackModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    type: 'success' | 'warning' | 'error'| 'loading';
  } | null>(null);

  // Fecha os dropdowns se clicar fora
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
      if (dropdownExportRef.current && !dropdownExportRef.current.contains(event.target as Node)) {
        setDropdownExportOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const formatDateTime = (iso: string) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const getMesPorExtenso = (anoMes: string) => {
    const [ano, mes] = anoMes.split('-');
    const data = new Date(parseInt(ano), parseInt(mes) - 1, 1);
    return data.toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
  };

  const fetchTasks = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const mesFormatado = mesFiltro.replace('-', '');
      
      const [resEmitidas, resTomadas] = await Promise.all([
        api.get(`/automacao/status`).catch(() => ({ data: { tasks: [] } })),
        api.get(`/automacao/tomadas/status?mesano=${mesFormatado}`).catch(() => ({ data: { tasks: [] } }))
      ]);
      
      const emitidas = resEmitidas.data.tasks || [];
      const tomadas = resTomadas.data.tasks || [];
      
      const merged = [...emitidas, ...tomadas].sort((a, b) => 
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      
      setTasks(merged);
    } catch (err) {
      console.error("Erro ao carregar tarefas:", err);
    } finally {
      setLoading(false);
    }
  }, [mesFiltro]);

  const carregarClientes = async () => {
    try {
      const { data } = await api.get('/clientes');
      setClientes(data.empresas || []);
    } catch (err) {
      console.error("Erro ao carregar clientes:", err);
    }
  };

  useEffect(() => {
    carregarClientes();
    fetchTasks();
    const interval = setInterval(() => fetchTasks(false), 15000);
    return () => clearInterval(interval);
  }, [fetchTasks]);

  useEffect(() => {
    setPaginaAtual(1); 
  }, [buscaTabela, mesFiltro, statusFiltro]);

  const getActiveTaskForClient = (cod: number) => {
    const mesFormatado = mesAgendamento.replace('-', '');
    return tasks.find(t => 
      t.cliente_cod === cod && 
      t.mesano === mesFormatado && 
      (t.status === 'pendente' || t.status === 'em_andamento')
    );
  };

  const handleAgendar = () => {
    const mesano = mesAgendamento.replace('-', '');
    
    if (selectedClientes.length === 0 || !mesano) {
      setFeedbackModal({
        isOpen: true,
        title: 'Atenção',
        message: 'Selecione pelo menos um cliente e um mês válido antes de continuar.',
        type: 'warning'
      });
      return;
    }

    const clientesParaProcessar = [...selectedClientes];
    setSelectedClientes([]);
    setClienteSearch('');
    setDropdownOpen(false);

    setFeedbackModal({
      isOpen: true,
      title: 'Download Solicitado!',
      message: `A busca para ${clientesParaProcessar.length} cliente(s) foi iniciada.\nOs XMLs serão baixados da nuvem e salvos fisicamente na pasta da rede.\n\nAcompanhe o progresso na tabela abaixo.`,
      type: 'success'
    });

    setTimeout(async () => {
      const endpointBase = tipoBusca === 'emitidas' ? '/automacao/agenda' : '/automacao/tomadas/agenda';
      
      for (const cli of clientesParaProcessar) {
        try {
          await api.post(`${endpointBase}/${cli.cod}`, { mesano });
        } catch (err) {
          console.error(`Erro ao agendar busca para o cliente ${cli.cod}:`, err);
        }
      }
      fetchTasks();
    }, 100);
  };

  const handleExportarNotasExcel = async () => {
    if (!selectedClienteExport || !mesExport) return;
    
    const mesano = mesExport.replace('-', '');
    const cnpjLimpo = selectedClienteExport.cnpj.replace(/\D/g, '');

    setIsExporting(true);
    setFeedbackModal({
      isOpen: true,
      title: 'Processando Relatório...',
      message: `Aguarde enquanto extraímos os XMLs para a empresa ${selectedClienteExport.empresa}.`,
      type: 'loading'
    });

    try {
      const response = await api.get(`/automacao/exportar-notas-excel?cnpj=${cnpjLimpo}&mesano=${mesano}`, {
        responseType: 'blob'
      });

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `Relatorio_Notas_${cnpjLimpo}_${mesano}.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      
      setFeedbackModal(null);
      setSelectedClienteExport(null);
      setClienteExportSearch('');
    } catch (err) {
      setFeedbackModal({
        isOpen: true,
        title: 'Falha na Exportação',
        message: 'Ocorreu um erro ao baixar as notas. Verifique se o cliente possui XMLs processados neste mês.',
        type: 'error'
      });
    } finally {
      setIsExporting(false);
    }
  };

  const shiftMonth = (delta: number) => {
    const [y, m] = mesFiltro.split('-').map(Number);
    const newDate = new Date(y, m - 1 + delta, 1);
    setMesFiltro(`${newDate.getFullYear()}-${String(newDate.getMonth() + 1).padStart(2, "0")}`);
  };

  const limparFiltrosTabela = () => {
    setBuscaTabela('');
    setStatusFiltro('todos');
    setSortConfig(null);
    setPaginaAtual(1);
  };

  const clientesFiltradosPesquisa = clientes.filter(c => 
    `${c.cod} ${c.empresa}`.toLowerCase().includes(clienteSearch.toLowerCase())
  );

  const clientesFiltradosExport = clientes.filter(c => 
    `${c.cod} ${c.empresa}`.toLowerCase().includes(clienteExportSearch.toLowerCase())
  );

  const handleDesmarcarTodas = () => {
    setSelectedClientes([]);
    setClienteSearch('');
  };

  const handleSort = (key: keyof Task) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  let tarefasFiltradas = tasks.filter(t => {
    const mesFormatado = mesFiltro.replace('-', '');
    if (t.mesano !== mesFormatado) return false;

    if (statusFiltro !== 'todos' && t.status !== statusFiltro) return false;

    const termo = buscaTabela.toLowerCase();
    if (termo) {
      return (
        String(t.cliente_cod).includes(termo) ||
        (t.empresa || '').toLowerCase().includes(termo) ||
        (t.cnpj || '').includes(termo) ||
        (t.status || '').toLowerCase().includes(termo) ||
        (t.username || '').toLowerCase().includes(termo)
      );
    }
    return true;
  });

  if (sortConfig !== null) {
    tarefasFiltradas.sort((a, b) => {
      let valA = a[sortConfig.key];
      let valB = b[sortConfig.key];

      if (valA === undefined || valA === null) valA = '';
      if (valB === undefined || valB === null) valB = '';

      if (typeof valA === 'string') valA = valA.toLowerCase();
      if (typeof valB === 'string') valB = valB.toLowerCase();

      if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
      if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }

  const totalPaginas = Math.max(1, Math.ceil(tarefasFiltradas.length / itensPorPagina));
  const indexInicio = (paginaAtual - 1) * itensPorPagina;
  const tarefasPaginadas = tarefasFiltradas.slice(indexInicio, indexInicio + itensPorPagina);

  const renderSortableTh = (label: string, sortKey: keyof Task, align: 'left' | 'center' = 'center', widthClass: string = '') => {
    const isActive = sortConfig?.key === sortKey;
    return (
      <th 
        className={`p-4 ${widthClass} ${align === 'center' ? 'text-center' : 'text-left'} text-[10px] font-black uppercase text-gray-500 tracking-widest cursor-pointer hover:bg-gray-100 transition-colors select-none group`}
        onClick={() => handleSort(sortKey)}
      >
        <div className={`flex items-center gap-1.5 ${align === 'center' ? 'justify-center' : 'justify-start'} ${isActive ? 'text-brand-dark' : ''}`}>
          {label}
          <div className="flex flex-col text-gray-300 shrink-0">
            {isActive && sortConfig.direction === 'asc' ? (
              <ChevronUp size={12} className="text-brand-yellow" strokeWidth={3} />
            ) : isActive && sortConfig.direction === 'desc' ? (
              <ChevronDown size={12} className="text-brand-yellow" strokeWidth={3} />
            ) : (
              <ChevronsUpDown size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />
            )}
          </div>
        </div>
      </th>
    );
  };

  return (
    <div className="space-y-6 font-['Poppins'] pb-10">
      
      <div className="mb-8 flex items-center gap-5 px-2">
        <div className="w-14 h-14 bg-brand-yellow/10 rounded-2xl flex items-center justify-center shrink-0 text-brand-yellow">
          <FolderDown size={28} />
        </div>
        
        <div className="space-y-0.5">
          <h1 className="text-2xl font-bold text-brand-dark tracking-tight">
            Download de <span className="text-brand-yellow font-medium">XML e Relatórios</span>
          </h1>
          <p className="text-[13px] text-gray-500 font-medium">
            Baixe e salve os arquivos físicos na rede local da sua empresa.
          </p>
        </div>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-green-100 flex flex-col md:flex-row items-start md:items-end gap-4 relative z-30">
        <div className="flex-1 w-full relative" ref={dropdownExportRef}>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[10px] font-black uppercase tracking-widest text-green-600 ml-1 flex items-center gap-1.5">
              <FileSpreadsheet size={12} /> Relatório Analítico de Notas (Excel)
            </label>
            {selectedClienteExport && (
              <button onClick={() => setSelectedClienteExport(null)} className="flex items-center gap-1 text-[9px] font-bold uppercase text-red-400 hover:text-red-600 transition-colors mr-1">
                <X size={10} /> Limpar
              </button>
            )}
          </div>
          
          <div className={`min-h-11.5 w-full px-2 py-1.5 bg-green-50/30 border rounded-lg focus-within:bg-white focus-within:border-green-300 transition-all flex flex-wrap gap-2 items-center cursor-text ${dropdownExportOpen ? 'border-green-300 bg-white' : 'border-transparent'}`} onClick={() => setDropdownExportOpen(true)}>
            <Search className="text-green-500 ml-1.5 shrink-0" size={16} />
            
            {selectedClienteExport ? (
              <span className="flex items-center gap-1.5 bg-green-600 text-white px-2.5 py-1 rounded text-xs font-semibold shrink-0">
                <span className="text-green-200">{selectedClienteExport.cod}</span> {selectedClienteExport.empresa}
              </span>
            ) : (
              <input 
                type="text"
                placeholder="Selecione UMA empresa para gerar o relatório..."
                value={clienteExportSearch}
                onChange={(e) => { setClienteExportSearch(e.target.value); setDropdownExportOpen(true); }}
                className="flex-1 min-w-30 bg-transparent outline-none text-sm font-semibold text-brand-dark px-2 py-1"
              />
            )}
            {!selectedClienteExport && <ChevronDown size={16} className={`text-green-500 mr-2 shrink-0 transition-transform ${dropdownExportOpen ? 'rotate-180' : ''}`} />}
          </div>

          {dropdownExportOpen && !selectedClienteExport && (
            <div className="absolute top-full left-0 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-xl z-50 max-h-60 overflow-y-auto custom-scrollbar">
              {clientesFiltradosExport.length > 0 ? (
                clientesFiltradosExport.map(c => (
                  <div key={c.cod} onClick={() => { setSelectedClienteExport(c); setClienteExportSearch(''); setDropdownExportOpen(false); }} className="px-4 py-2.5 text-sm font-semibold text-brand-dark hover:bg-green-50 cursor-pointer flex flex-col border-b border-gray-50 last:border-0">
                    <span className="text-green-600 text-[10px] font-black">{c.cod}</span>
                    <span className="truncate">{c.empresa}</span>
                  </div>
                ))
              ) : (
                <div className="px-4 py-6 text-center text-gray-500 text-xs font-medium">Nenhum cliente encontrado.</div>
              )}
            </div>
          )}
        </div>

        <div className="space-y-1.5 w-full md:w-48 shrink-0">
          <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 ml-1">Mês das Notas</label>
          <div className="relative">
            <Calendar className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500 z-10 pointer-events-none" size={16} />
            <DatePicker
              selected={mesExport ? new Date(parseInt(mesExport.split('-')[0]), parseInt(mesExport.split('-')[1]) - 1, 1) : null}
              onChange={(date: Date | null) => {
                if (date) {
                  setMesExport(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`);
                }
              }}
              dateFormat="MMMM yyyy"
              showMonthYearPicker
              locale="pt-BR"
              wrapperClassName="w-full"
              className="w-full pl-10 pr-4 h-11.5 bg-gray-50 border border-transparent rounded-lg focus:bg-white focus:border-gray-200 outline-none text-sm font-bold text-brand-dark transition-all uppercase cursor-pointer"
            />
          </div>
        </div>

        <button 
          onClick={handleExportarNotasExcel}
          disabled={!selectedClienteExport || isExporting}
          className={`h-11.5 px-8 rounded-lg font-black text-[11px] uppercase tracking-widest transition-all flex items-center justify-center gap-2 shadow-md w-full md:w-auto shrink-0 ${
            selectedClienteExport 
            ? 'bg-green-600 text-white hover:bg-green-700 cursor-pointer shadow-green-500/20' 
            : 'bg-gray-100 text-gray-500 cursor-not-allowed'
          }`}
        >
          {isExporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />} 
          {isExporting ? 'Baixando...' : 'Baixar Analítico'}
        </button>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex flex-col md:flex-row items-start md:items-end gap-4 relative z-20">
        
        <div className="flex flex-col gap-2 w-full md:w-auto shrink-0 border-r border-gray-100 pr-4">
          <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 ml-1">Tipo de Busca</label>
          <div className="flex bg-gray-50 p-1 rounded-lg w-full md:w-fit border border-gray-100">
            <button
              onClick={() => setTipoBusca('emitidas')}
              className={`flex-1 md:flex-none px-4 py-2 text-[11px] font-bold uppercase tracking-wider rounded-md transition-all ${
                tipoBusca === 'emitidas' ? 'bg-blue-50 text-blue-600 border border-blue-100 shadow-sm' : 'text-gray-500 hover:text-blue-500'
              }`}
            >
              Emitidas
            </button>
            <button
              onClick={() => setTipoBusca('tomadas')}
              className={`flex-1 md:flex-none px-4 py-2 text-[11px] font-bold uppercase tracking-wider rounded-md transition-all ${
                tipoBusca === 'tomadas' ? 'bg-purple-50 text-purple-600 border border-purple-100 shadow-sm' : 'text-gray-500 hover:text-purple-500'
              }`}
            >
              Tomadas
            </button>
          </div>
        </div>

        <div className="flex-1 w-full relative" ref={dropdownRef}>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[10px] font-black uppercase tracking-widest text-brand-dark ml-1 flex items-center gap-1.5">
              <FolderDown size={12} /> Buscar XML ({tipoBusca === 'emitidas' ? 'Emitidas' : 'Tomadas'})
            </label>
            <div className="flex gap-3">
              {selectedClientes.length > 0 && (
                <button onClick={handleDesmarcarTodas} className="flex items-center gap-1 text-[9px] font-bold uppercase text-red-400 hover:text-red-600 transition-colors mr-1">
                  <X size={10} /> Limpar Seleção
                </button>
              )}
            </div>
          </div>
          
          <div className={`min-h-11.5 w-full px-2 py-1.5 bg-gray-50 border rounded-lg focus-within:bg-white focus-within:border-gray-300 transition-all flex flex-wrap gap-2 items-center cursor-text ${dropdownOpen ? 'border-gray-300 bg-white' : 'border-transparent'}`} onClick={() => setDropdownOpen(true)}>
            <Search className="text-gray-500 ml-1.5 shrink-0" size={16} />
            
            {selectedClientes.length > 5 ? (
               <span className="flex items-center gap-1.5 bg-brand-dark text-white px-2.5 py-1 rounded text-xs font-semibold shrink-0">
                 {selectedClientes.length} Empresas Selecionadas
                 <button onClick={(e) => { e.stopPropagation(); setSelectedClientes([]); }} className="hover:text-red-400 focus:outline-none ml-1"><X size={12} /></button>
               </span>
            ) : (
              selectedClientes.map(cli => (
                <span key={cli.cod} className="flex items-center gap-1.5 bg-brand-dark text-white px-2.5 py-1 rounded text-xs font-semibold shrink-0">
                  <span className="text-brand-yellow">{cli.cod}</span> {cli.empresa.length > 15 ? cli.empresa.substring(0, 15) + '...' : cli.empresa}
                  <button onClick={(e) => { e.stopPropagation(); setSelectedClientes(prev => prev.filter(c => c.cod !== cli.cod)); }} className="hover:text-red-400 focus:outline-none ml-1">
                    <X size={12} />
                  </button>
                </span>
              ))
            )}

            <input 
              type="text"
              placeholder={selectedClientes.length === 0 ? "Busque e marque os clientes desejados..." : ""}
              value={clienteSearch}
              onChange={(e) => { setClienteSearch(e.target.value); setDropdownOpen(true); }}
              className="flex-1 min-w-30 bg-transparent outline-none text-sm font-semibold text-brand-dark px-2 py-1"
            />
            <ChevronDown size={16} className={`text-gray-500 mr-2 shrink-0 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
          </div>

          {dropdownOpen && (
            <div className="absolute top-full left-0 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-xl z-50 max-h-60 overflow-y-auto custom-scrollbar">
              {clientesFiltradosPesquisa.length > 0 ? (
                clientesFiltradosPesquisa.map(c => {
                  const activeTask = getActiveTaskForClient(c.cod);
                  const isSelected = selectedClientes.some(s => s.cod === c.cod);
                  
                  return (
                    <label 
                      key={c.cod} 
                      className={`px-4 py-2.5 flex items-center justify-between border-b border-gray-50 last:border-0 transition-colors ${
                        activeTask ? 'bg-gray-50 opacity-60 cursor-not-allowed' : 
                        isSelected ? 'bg-yellow-50/30 cursor-pointer' : 'hover:bg-gray-50 cursor-pointer'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <input 
                          type="checkbox" 
                          checked={isSelected || !!activeTask}
                          disabled={!!activeTask}
                          onChange={(e) => {
                            if (activeTask) return; 
                            if (e.target.checked) {
                              setSelectedClientes(prev => [...prev, c]);
                              setClienteSearch('');
                            } else {
                              setSelectedClientes(prev => prev.filter(s => s.cod !== c.cod));
                            }
                          }}
                          style={{ accentColor: activeTask ? '#9ca3af' : '#fdb913' }} 
                          className={`w-4 h-4 rounded border-gray-300 ${activeTask ? 'cursor-not-allowed' : 'cursor-pointer'}`} 
                        />
                        <div className="flex flex-col">
                          <span className="text-sm font-semibold text-brand-dark truncate">
                            <span className={`${activeTask ? 'text-gray-500' : 'text-brand-yellow'} text-[10px] font-black mr-2`}>{c.cod}</span>
                            {c.empresa}
                          </span>
                        </div>
                      </div>

                      {activeTask && (
                        <span className="text-[8px] font-black uppercase tracking-widest text-yellow-600 bg-yellow-50 px-2 py-0.5 rounded border border-yellow-100 flex items-center gap-1">
                          <Clock size={10} /> {activeTask.status === 'em_andamento' ? 'Baixando' : 'Na fila'}
                        </span>
                      )}
                    </label>
                  );
                })
              ) : (
                <div className="px-4 py-6 text-center text-gray-500 text-xs font-medium">Nenhum cliente encontrado.</div>
              )}
            </div>
          )}
        </div>

        <div className="space-y-1.5 w-full md:w-48 shrink-0">
          <label className="text-[10px] font-black uppercase tracking-widest text-gray-500 ml-1">Mês Base</label>
          <div className="relative">
            <Calendar className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500 z-10 pointer-events-none" size={16} />
            <DatePicker
              selected={mesAgendamento ? new Date(parseInt(mesAgendamento.split('-')[0]), parseInt(mesAgendamento.split('-')[1]) - 1, 1) : null}
              onChange={(date: Date | null) => {
                if (date) {
                  setMesAgendamento(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`);
                }
              }}
              dateFormat="MMMM yyyy"
              showMonthYearPicker
              locale="pt-BR"
              wrapperClassName="w-full"
              className="w-full pl-10 pr-4 h-11.5 bg-gray-50 border border-transparent rounded-lg focus:bg-white focus:border-gray-200 outline-none text-sm font-bold text-brand-dark transition-all uppercase cursor-pointer"
            />
          </div>
        </div>

        <button 
          onClick={handleAgendar}
          disabled={selectedClientes.length === 0}
          className={`h-11.5 px-8 rounded-lg font-black text-[11px] uppercase tracking-widest transition-all flex items-center justify-center gap-2 shadow-md w-full md:w-auto shrink-0 ${
            selectedClientes.length > 0 
            ? 'bg-brand-dark text-white hover:text-brand-yellow cursor-pointer hover:shadow-lg' 
            : 'bg-gray-100 text-gray-500 cursor-not-allowed'
          }`}
        >
          <FolderDown size={16} /> Baixar XMLs
        </button>
      </div>

      <div className="flex flex-col xl:flex-row gap-4 xl:items-center justify-between bg-white p-4 rounded-xl shadow-sm border border-gray-100 relative z-10">
        
        <div className="flex items-center gap-2 bg-gray-50 p-1.5 rounded-lg border border-gray-100">
          <button onClick={() => shiftMonth(-1)} className="p-2 hover:bg-white rounded transition-all text-brand-dark"><ChevronLeft size={18} /></button>
          <div className="flex items-center gap-2 px-4">
            <Calendar size={16} className="text-brand-yellow" />
            <span className="font-black text-sm text-brand-dark uppercase cursor-default">{getMesPorExtenso(mesFiltro)}</span>
          </div>
          <button onClick={() => shiftMonth(1)} className="p-2 hover:bg-white rounded transition-all text-brand-dark"><ChevronRight size={18} /></button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          
          <div className="relative">
            <Search className="absolute left-3 top-2.5 text-gray-500" size={16} />
            <input 
              type="text" 
              placeholder="Buscar na tabela..." 
              value={buscaTabela}
              onChange={(e) => setBuscaTabela(e.target.value)}
              className="pl-9 pr-3 py-2 bg-gray-50 border border-transparent rounded-lg text-xs font-bold outline-none focus:bg-white focus:border-gray-200 w-52 text-brand-dark transition-all" 
            />
          </div>

          <div className="relative flex items-center bg-gray-50 border border-transparent rounded-lg focus-within:bg-white focus-within:border-gray-200 transition-all">
            <Filter className="absolute left-3 text-brand-yellow" size={14} />
            <select
              value={statusFiltro}
              onChange={(e) => setStatusFiltro(e.target.value)}
              className="pl-9 pr-8 py-2 bg-transparent text-[11px] font-bold uppercase tracking-wider outline-none w-44 text-brand-dark cursor-pointer appearance-none"
            >
              <option value="todos">Todos Status</option>
              <option value="pendente">Pendente</option>
              <option value="em_andamento">Baixando</option>
              <option value="concluído">Concluído</option>
              <option value="erro">Erro</option>
            </select>
            <ChevronDown className="absolute right-3 text-gray-500 pointer-events-none" size={14} />
          </div>

          {(buscaTabela || statusFiltro !== 'todos' || sortConfig !== null) && (
            <button onClick={limparFiltrosTabela} className="text-[10px] uppercase font-bold text-gray-500 hover:text-red-500 transition-colors px-2">
              Limpar
            </button>
          )}

          <div className="w-px h-6 bg-gray-200 mx-1 hidden md:block"></div>

          <button onClick={() => fetchTasks(true)} title="Atualizar fila de download" className="flex items-center justify-center p-2.5 bg-gray-50 text-gray-500 rounded-lg hover:bg-gray-100 transition-all border border-gray-100 shrink-0">
            <RefreshCw size={16} className={loading ? 'animate-spin text-brand-yellow' : ''} />
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden relative z-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="bg-brand-panel">
                {renderSortableTh('Empresa / CNPJ', 'empresa', 'left')}
                {renderSortableTh('Período', 'mesano', 'center')}
                {renderSortableTh('Status Download', 'status', 'center')}
                {renderSortableTh('Solicitante', 'username', 'center')}
                {renderSortableTh('Data Solicitação', 'created_at', 'center')}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                <tr><td colSpan={7} className="p-12 text-center text-gray-300 font-bold italic animate-pulse">Consultando fila de downloads...</td></tr>
              ) : tarefasPaginadas.length === 0 ? (
                <tr><td colSpan={7} className="p-12 text-center text-gray-500 font-bold">Nenhuma tarefa de download encontrada para este período com os filtros atuais.</td></tr>
              ) : tarefasPaginadas.map((t, idx) => {
                
                const displayStatus = t.status === 'arquivada' ? 'concluído' : t.status;
                const clienteAtivo = clientes.find(c => c.cod === t.cliente_cod);

                return (
                  <tr key={idx} className={`hover:bg-gray-50/80 transition-colors group ${!clienteAtivo ? 'opacity-70' : ''}`}>
                    
                    <td className="p-4 align-top max-w-70 border-r border-gray-50">
                      <div className="flex flex-col gap-0.5">
                        <div className="font-bold text-brand-dark truncate flex flex-wrap items-center gap-1.5" title={t.empresa}>
                          <span className="text-brand-yellow font-black">{t.cliente_cod}</span>
                          {t.empresa}
                          
                          <span className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-tight ${
                            t.tipo?.includes('tomadas') ? 'bg-purple-50 text-purple-600 border border-purple-100' : 'bg-blue-50 text-blue-600 border border-blue-100'
                          }`}>
                            {t.tipo?.includes('tomadas') ? 'Tomadas' : 'Emitidas'}
                          </span>
                          
                          {/* Verifica se o cliente tem alerta de certificado */}
                          {(t.cert_status === 'Vencido' || t.cert_status === 'Sem certificado' || t.cert_status === 'Não Vinculado') && (
                            <span 
                              title={`ALERTA: Certificado ${t.cert_status}${t.cert_validade && t.cert_validade !== '-' ? ` em ${t.cert_validade}` : ''}`}
                              className="flex items-center"
                            >
                              <AlertTriangle 
                                size={14} 
                                className="text-red-500 fill-red-50 animate-pulse shrink-0 cursor-help" 
                              />
                            </span>
                          )}

                          {!clienteAtivo && (
                            <span className="bg-red-50 text-red-500 border border-red-100 px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-tight">
                              Inativo
                            </span>
                          )}
                        </div>
                        <div className="text-[12px] font-bold text-gray-500 font-mono tracking-tighter">{t.cnpj}</div>
                      </div>
                    </td>
                    
                    <td className="p-4 text-center font-semibold text-gray-600">
                      {t.mesano && t.mesano.length === 6 ? `${t.mesano.substring(4, 6)}/${t.mesano.substring(0, 4)}` : t.mesano}
                    </td>
                    
                    <td className="p-4 text-center">
                      <div className="flex flex-col items-center justify-center relative">
                        <span className={`px-2.5 py-1 rounded text-[9px] font-black uppercase flex items-center gap-1.5 border ${
                          ['concluído', 'arquivada'].includes(t.status) ? 'bg-green-50 text-green-600 border-green-100' : 
                          t.status === 'erro' ? 'bg-red-50 text-red-600 border-red-100' : 
                          'bg-yellow-50 text-yellow-600 border-yellow-100'
                        }`}>
                          {['concluído', 'arquivada'].includes(t.status) && <CheckCircle2 size={12} />}
                          {t.status === 'erro' && <AlertCircle size={12} />}
                          {['pendente', 'em_andamento'].includes(t.status) && <Clock size={12} className="animate-spin" />}
                          {t.status === 'em_andamento' ? 'baixando...' : displayStatus.replace('_', ' ')}
                        </span>
                        {t.status === 'erro' && t.error_msg && (
                          <div className="hidden group-hover:block absolute bottom-8 left-1/2 -translate-x-1/2 w-56 p-2.5 bg-brand-dark text-white text-[10px] font-medium rounded-lg shadow-xl z-20 text-center leading-relaxed">
                            {t.error_msg}
                          </div>
                        )}
                      </div>
                    </td>
                    
                    <td className="p-4 text-center text-gray-500 font-medium capitalize">
                      {t.tipo === 'xml' || t.tipo === 'xml_tomadas' ? 'Rotina Automática' : (t.username || 'Sistema')}
                    </td>

                    <td className="p-4 text-center text-gray-500 text-xs font-medium">
                      {formatDateTime(t.created_at)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {!loading && tarefasFiltradas.length > 0 && (
          <div className="bg-white border-t border-gray-100 p-4 flex items-center justify-between text-[10px] font-black text-gray-500 uppercase tracking-widest">
            <div>
              Mostrando <span className="text-brand-dark">{indexInicio + 1} - {Math.min(indexInicio + itensPorPagina, tarefasFiltradas.length)}</span> de {tarefasFiltradas.length}
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => setPaginaAtual(prev => Math.max(prev - 1, 1))} disabled={paginaAtual === 1} className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-20 transition-all text-brand-dark">
                <ChevronLeft size={16} />
              </button>
              <span className="text-brand-dark">Pág {paginaAtual} / {totalPaginas}</span>
              <button onClick={() => setPaginaAtual(prev => Math.min(prev + 1, totalPaginas))} disabled={paginaAtual === totalPaginas} className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-20 transition-all text-brand-dark">
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      {feedbackModal && feedbackModal.isOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-100 p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-[25px] shadow-2xl w-full max-w-sm overflow-hidden flex flex-col border border-gray-100 animate-in zoom-in-95 duration-200">
            
            <div className={`bg-brand-dark px-6 py-4 flex items-center justify-between border-b-4 ${
              feedbackModal.type === 'success' ? 'border-green-500' : 
              feedbackModal.type === 'error' ? 'border-red-500' : 
              feedbackModal.type === 'loading' ? 'border-brand-yellow' : 'border-brand-yellow'
            }`}>
              <div className="flex items-center gap-2 text-white">
                {feedbackModal.type === 'success' ? <CheckCircle2 size={20} className="text-green-500" /> : 
                 feedbackModal.type === 'error' ? <X size={20} className="text-red-500" /> : 
                 feedbackModal.type === 'loading' ? <Loader2 size={20} className="text-brand-yellow animate-spin" /> : 
                 <AlertTriangle size={20} className="text-brand-yellow" />}
                <h2 className="font-bold text-lg tracking-tight">{feedbackModal.title}</h2>
              </div>
              
              {feedbackModal.type !== 'loading' && (
                <button onClick={() => setFeedbackModal(null)} className="text-gray-500 hover:text-white transition-colors">
                  <X size={22} />
                </button>
              )}
            </div>
            
            <div className="p-8 text-center space-y-6">
              <p className="text-brand-dark text-sm leading-relaxed font-bold whitespace-pre-line">
                {feedbackModal.message}
              </p>
              
              {feedbackModal.type !== 'loading' && (
                <button 
                  onClick={() => setFeedbackModal(null)} 
                  className="w-full px-4 py-3.5 bg-brand-dark hover:bg-brand-dark-hover text-white rounded-xl font-black text-[10px] uppercase tracking-widest transition-all shadow-md hover:text-brand-yellow"
                >
                  Entendido
                </button>
              )}
            </div>
            
          </div>
        </div>
      )}

      <style>{`.custom-scrollbar::-webkit-scrollbar{width:4px}.custom-scrollbar::-webkit-scrollbar-track{background:#f1f1f1;border-radius:4px}.custom-scrollbar::-webkit-scrollbar-thumb{background:#d1d5db;border-radius:4px}`}</style>
    </div>
  );
};