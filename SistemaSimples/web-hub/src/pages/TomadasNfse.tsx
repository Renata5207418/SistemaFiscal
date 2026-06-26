import React, { useEffect, useState, useCallback, useRef } from 'react';
import api from '../services/api';
import { 
  Search, Calendar, ChevronDown, ChevronRight, FileText, 
  Zap, Filter, ChevronUp, ChevronsUpDown, ChevronLeft, AlertTriangle, Download, Loader2, Info, CheckCircle2, X
} from 'lucide-react';

import DatePicker, { registerLocale } from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { ptBR } from "date-fns/locale"; 

registerLocale("pt-BR", ptBR);

interface NotaRetencao {
  chave_nfse: string;
  numero_nfse: string;
  data_competencia: string;
  emit_cnpj: string;
  emit_nome: string;
  valor_servico: number;
  valor_retencao: number;
  codigo_servico: string;
  trib_issqn: string;
  tp_ret_issqn: string;
  arquivo_s3: string;
}

interface Tomada {
  cod_cliente: number;
  cnpj: string;
  empresa: string;
  grupo: string;
  mesano: string;
  quantidade_notas_validas: number;
  quantidade_canceladas: number;
  total_tomadas: number;
  total_retencao: number;
  quantidade_xmls_s3: number;
  quantidade_retencao: number;
  notas_retencao: NotaRetencao[];
  updated_at: string;
  cert_status?: string;   
  cert_validade?: string;
  conferencia?: { status: boolean; user: string; date: string };
}

type SortConfig = { key: keyof Tomada | string; direction: 'asc' | 'desc'; } | null;

export const TomadasNfse: React.FC = () => {
  const [tomadas, setTomadas] = useState<Tomada[]>([]);
  const [busca, setBusca] = useState('');
  const [loading, setLoading] = useState(false);
  const [expandedRows, setExpandedRows] = useState<number[]>([]);
  
  // --- ESTADOS DE CONFERÊNCIA MANUAL ---
  const [validados, setValidados] = useState<Record<number, { date: string, user: string }>>({});
  
  // --- ESTADOS DE SELEÇÃO E LOTE ---
  const [selectedCodigos, setSelectedCodigos] = useState<number[]>([]);
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);

  // --- ESTADOS DE EXPORTAÇÃO ---
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [isConvertingXML, setIsConvertingXML] = useState(false);
  const exportDropdownRef = useRef<HTMLDivElement>(null);

  // --- ESTADOS DE ORDENAÇÃO E PAGINAÇÃO ---
  const [sortConfig, setSortConfig] = useState<SortConfig>(null);
  const [paginaAtual, setPaginaAtual] = useState(1);
  const itensPorPagina = 10;

  // --- ESTADOS DOS FILTROS EXCEL ---
  const [filtroValoresServico, setFiltroValoresServico] = useState<number[] | null>(null);
  const [popoverServicoAberto, setPopoverServicoAberto] = useState(false);
  const popoverServicoRef = useRef<HTMLDivElement>(null);

  const [filtroValoresRetencao, setFiltroValoresRetencao] = useState<number[] | null>(null);
  const [popoverRetencaoAberto, setPopoverRetencaoAberto] = useState(false);
  const popoverRetencaoRef = useRef<HTMLDivElement>(null);

  const [filtroConferencia, setFiltroConferencia] = useState<string[] | null>(null);
  const [popoverConferenciaAberto, setPopoverConferenciaAberto] = useState(false);
  const popoverConferenciaRef = useRef<HTMLDivElement>(null);

  // --- ESTADO DO NOVO MODAL ---
  const [modalAviso, setModalAviso] = useState<{isOpen: boolean, titulo: string, mensagem: string}>({isOpen: false, titulo: '', mensagem: ''});

  const [mesano, setMesano] = useState(() => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  // Fecha popovers e dropdowns ao clicar fora
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popoverServicoRef.current && !popoverServicoRef.current.contains(event.target as Node)) setPopoverServicoAberto(false);
      if (popoverRetencaoRef.current && !popoverRetencaoRef.current.contains(event.target as Node)) setPopoverRetencaoAberto(false);
      if (popoverConferenciaRef.current && !popoverConferenciaRef.current.contains(event.target as Node)) setPopoverConferenciaAberto(false);
      if (exportDropdownRef.current && !exportDropdownRef.current.contains(event.target as Node)) setIsExportMenuOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const formatBRL = (v: any) => (typeof v === 'number' ? v : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  
  const formatCNPJ = (cnpjRaw: string) => {
    if (!cnpjRaw) return '?';
    const num = String(cnpjRaw).replace(/\D/g, '');
    return num.length === 14 ? num.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5") : String(cnpjRaw);
  };
  
  const formatData = (isoDate: string) => {
    if (!isoDate) return '?';
    const safeDate = isoDate.endsWith('Z') || isoDate.includes('+') ? isoDate : `${isoDate}Z`;
    const d = new Date(safeDate);
    if (isNaN(d.getTime())) return isoDate;
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  };

  const formatDataSimples = (dataStr: string) => {
    if (!dataStr) return '?';
    const partes = dataStr.split('-');
    if (partes.length === 3) return `${partes[2]}/${partes[1]}/${partes[0]}`;
    return dataStr;
  };

  const fetchData = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const { data } = await api.get(`/automacao/tomadas/xml?mesano=${mesano}`);
      if (data.tomadas) {
        setTomadas(data.tomadas);

        // Alimenta o estado de validados com os dados do banco
        const novosValidados: Record<number, { date: string, user: string }> = {};
        data.tomadas.forEach((t: any) => {
          if (t.conferencia && t.conferencia.status) {
            novosValidados[t.cod_cliente] = { date: t.conferencia.date, user: t.conferencia.user };
          }
        });
        setValidados(novosValidados);
      } else {
        setTomadas([]);
        setValidados({});
      }
    } catch (err) {
      console.error("Erro ao carregar NFSe Tomadas:", err);
      setTomadas([]);
      setValidados({});
    } finally {
      setLoading(false);
    }
  }, [mesano]);

  useEffect(() => {
    fetchData(); 
    
    const interval = setInterval(() => {
      fetchData(false);
    }, 5000);

    return () => clearInterval(interval);
  }, [fetchData]);

  // --- FUNÇÃO PARA SALVAR O VISTO MANUAL ---
  const toggleValidado = async (cod: number) => {
    try {
      const { data } = await api.post('/automacao/tomadas/conferencia/toggle', {
        cod_cliente: cod,
        mesano: mesano
      });
      setValidados(prev => {
        const next = { ...prev };
        if (data.status) {
          next[cod] = { date: data.date, user: data.user };
        } else {
          delete next[cod]; 
        }
        return next;
      });
    } catch (error) {
      console.error("Erro ao salvar conferência de tomadas", error);
      alert("Erro ao salvar conferência no banco de dados.");
    }
  };

  const toggleRow = (cod: number) => {
    setExpandedRows(prev => prev.includes(cod) ? prev.filter(id => id !== cod) : [...prev, cod]);
  };

  const shiftMonth = (delta: number) => {
    if (!mesano) return;
    const y = parseInt(mesano.substring(0, 4));
    const m = parseInt(mesano.substring(4, 6));
    const newDate = new Date(y, m - 1 + delta, 1);
    setMesano(`${newDate.getFullYear()}${String(newDate.getMonth() + 1).padStart(2, "0")}`);
  };

  const handleSort = (key: keyof Tomada | string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') direction = 'desc';
    setSortConfig({ key, direction });
  };

  // Reseta página ao alterar filtros
  useEffect(() => { 
    setPaginaAtual(1); 
  }, [busca, mesano, filtroValoresServico, filtroValoresRetencao, filtroConferencia]);

  // --- FILTRAGEM MASTER ---
  let tomadasFiltradas = tomadas.filter(t => {
    const mBusca = (t.empresa || '').toLowerCase().includes(busca.toLowerCase()) || 
                   (t.cod_cliente || '').toString().includes(busca) || 
                   (t.cnpj || '').includes(busca);
    
    const mServico = filtroValoresServico === null || filtroValoresServico.includes(t.total_tomadas);
    const mRetencao = filtroValoresRetencao === null || filtroValoresRetencao.includes(t.total_retencao);

    const statusConf = !!validados[t.cod_cliente] ? 'conferidos' : 'pendentes';
    const mConf = filtroConferencia === null || filtroConferencia.includes(statusConf);

    return mBusca && mServico && mRetencao && mConf;
  });

  // --- ORDENAÇÃO ---
  if (sortConfig !== null) {
    tomadasFiltradas.sort((a: any, b: any) => {
      if (a[sortConfig.key] < b[sortConfig.key]) return sortConfig.direction === 'asc' ? -1 : 1;
      if (a[sortConfig.key] > b[sortConfig.key]) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }

  // --- PAGINAÇÃO E SELEÇÃO ---
  const totalPaginas = Math.max(1, Math.ceil(tomadasFiltradas.length / itensPorPagina));
  const indexInicio = (paginaAtual - 1) * itensPorPagina;
  const tomadasPaginadas = tomadasFiltradas.slice(indexInicio, indexInicio + itensPorPagina);

  const isAllSelected = tomadasFiltradas.length > 0 && selectedCodigos.length === tomadasFiltradas.length;
  
  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => { 
    e.target.checked ? setSelectedCodigos(tomadasFiltradas.map(t => t.cod_cliente)) : setSelectedCodigos([]); 
  };
  
  const handleSelectRow = (cod: number) => {
    setSelectedCodigos(prev => prev.includes(cod) ? prev.filter(c => c !== cod) : [...prev, cod]);
  };

  const hasActiveFilters = busca !== '' || filtroValoresServico !== null || filtroValoresRetencao !== null || filtroConferencia !== null || sortConfig !== null;

  const limparTodosOsFiltros = () => {
    setBusca('');
    setSortConfig(null);
    setPaginaAtual(1);
    setFiltroValoresServico(null);
    setFiltroValoresRetencao(null);
    setFiltroConferencia(null);
    setSelectedCodigos([]);
  };

  // --- AÇÕES EM LOTE DA API ---
  const handleAtualizarValores = async () => {
    if (selectedCodigos.length === 0) return;
    setIsBatchProcessing(true);
    
    try {
      await api.post(`/automacao/tomadas/agenda-valor`, {
        mesano: mesano,
        codigos: selectedCodigos
      });
    } catch (err) {
      console.error("Erro ao agendar valores em lote", err);
    }
    
    setSelectedCodigos([]);
    setIsBatchProcessing(false);
  };

  // --- AÇÕES DE EXPORTAÇÃO EXCEL ---
  const handleExportarExcel = async (tipo: 'totais-empresas' | 'retencoes') => {
    setIsExportMenuOpen(false);
    
    try {
      const response = await api.get(`/automacao/tomadas/exportar/${tipo}?mesano=${mesano}`, { 
        responseType: 'blob' 
      });
      
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      
      const nomeArquivo = tipo === 'totais-empresas' 
        ? `Relatorio_Tomadas_Totais_${mesano}.xlsx` 
        : `Relatorio_Tomadas_Retencoes_${mesano}.xlsx`;
        
      link.setAttribute('download', nomeArquivo);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      console.error(`Erro ao exportar excel (${tipo})`, err);
    }
  };

  const handleConversaoXML = async () => {
    setIsConvertingXML(true);
    try {
      const { data } = await api.get(`/automacao/tomadas/exportar/xml-convertido?mesano=${mesano}`);
      
      setModalAviso({
        isOpen: true,
        titulo: "Processando Relatório...",
        mensagem: data.mensagem || "Aguarde enquanto extraímos os XMLs para a planilha detalhada."
      });
      
    } catch (err) {
      console.error("Erro na conversão do XML detalhado", err);
      setModalAviso({
        isOpen: true,
        titulo: "Falha na Solicitação",
        mensagem: "Erro ao solicitar a conversão da planilha. Tente novamente mais tarde."
      });
    } finally {
      setIsConvertingXML(false); 
    }
  };

  // Valores únicos para popular os menus do Excel
  const valoresServicoUnicos = Array.from(new Set(tomadas.map(t => t.total_tomadas))).sort((a,b)=>a-b);
  const valoresRetencaoUnicos = Array.from(new Set(tomadas.map(t => t.total_retencao))).sort((a,b)=>a-b);
  const valoresConferenciaUnicos = ['conferidos', 'pendentes'];

  // --- FUNÇÕES RENDER HEADERS ---
  const renderTh = (label: string, sortKey: keyof Tomada | string, align: 'left'|'center'|'right' = 'left') => {
    const isActiveSort = sortConfig !== null && sortConfig.key === sortKey;
    return (
      <th className={`p-3 align-middle relative select-none bg-brand-panel group border-b border-gray-50`}>
        <div className={`flex items-center gap-1.5 ${align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start'}`}>
          <span className={`font-black uppercase text-[10px] tracking-widest cursor-pointer hover:text-brand-yellow transition-colors ${isActiveSort ? 'text-brand-dark' : 'text-gray-500'}`} onClick={() => handleSort(sortKey)}>{label}</span>
          <div onClick={() => handleSort(sortKey)} className="cursor-pointer text-gray-300">
            {isActiveSort && sortConfig !== null && sortConfig.direction === 'asc' ? <ChevronUp size={12} className="text-brand-yellow" /> : 
             isActiveSort && sortConfig !== null && sortConfig.direction === 'desc' ? <ChevronDown size={12} className="text-brand-yellow" /> : 
             <ChevronsUpDown size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />}
          </div>
        </div>
      </th>
    );
  };

  const renderExcelTh = (
      label: string,
      sortKey: keyof Tomada | string, 
      filterValues: any[] | null,
      setFilterValues: React.Dispatch<React.SetStateAction<any[] | null>>,
      isPopoverOpen: boolean,
      setPopoverOpen: React.Dispatch<React.SetStateAction<boolean>>,
      popoverRef: any,
      uniqueOptions: any[],
      formatLabel: (val: any) => string,
      align: 'left' | 'center' = 'left'
  ) => {
      const isActive = sortConfig?.key === sortKey;
      return (
        <th className="p-3 relative bg-brand-panel border-b border-gray-50">
          <div className={`flex items-center gap-1.5 ${align === 'center' ? 'justify-center' : 'justify-start'} text-[10px] font-black uppercase text-gray-500 tracking-widest select-none group`}>
            <span className="cursor-pointer hover:text-gray-600 transition-colors" onClick={() => handleSort(sortKey)}>
              {label}
            </span>
            
            <div className="flex flex-col text-gray-400 cursor-pointer" onClick={() => handleSort(sortKey)}>
              {isActive ? (
                sortConfig.direction === 'asc' ? <ChevronUp size={12} className="text-brand-yellow" /> : <ChevronDown size={12} className="text-brand-yellow" />
              ) : (
                <ChevronsUpDown size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />
              )}
            </div>

            <div ref={popoverRef} className="relative ml-1">
              <button 
                onClick={() => setPopoverOpen(!isPopoverOpen)}
                className={`p-1 rounded transition-colors ${filterValues !== null ? 'bg-blue-200 text-brand-yellow' : 'text-gray-300 hover:text-gray-500 hover:bg-gray-100'}`}
              >
                <Filter size={12} className={filterValues !== null ? 'fill-brand-yellow/20' : ''} />
              </button>

              {isPopoverOpen && (
                <div className={`absolute top-full ${align === 'center' ? 'left-1/2 -translate-x-1/2' : 'left-0'} mt-2 bg-white border border-gray-100 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.1)] rounded-xl p-3 z-50 w-56 text-left normal-case tracking-normal`}>
                  <div className="max-h-48 overflow-y-auto custom-scrollbar flex flex-col gap-1.5 mb-3 pr-1">
                    
                    <label className="flex items-center gap-2 cursor-pointer text-[11px] font-black text-brand-dark hover:bg-gray-100 p-1.5 rounded transition-colors border-b border-gray-100 pb-2 mb-1">
                      <input
                        type="checkbox"
                        checked={filterValues === null || filterValues.length === uniqueOptions.length}
                        onChange={(e) => { e.target.checked ? setFilterValues(null) : setFilterValues([]); }}
                        className="rounded border-gray-300 w-3.5 h-3.5"
                        style={{ accentColor: '#fdb913' }}
                      />
                      (Selecionar Tudo)
                    </label>

                    {uniqueOptions.map(val => {
                      const isChecked = filterValues === null || filterValues.includes(val);
                      return (
                        <label key={String(val)} className="flex items-center gap-2 cursor-pointer text-[11px] font-medium text-brand-dark hover:bg-gray-50 p-1.5 rounded transition-colors">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setFilterValues([...(filterValues || []), val]);
                              } else {
                                const curr = filterValues === null ? uniqueOptions : filterValues;
                                setFilterValues(curr.filter(v => v !== val));
                              }
                            }}
                            className="rounded border-gray-300 w-3.5 h-3.5"
                            style={{ accentColor: '#fdb913' }}
                          />
                          {formatLabel(val)}
                        </label>
                      );
                    })}
                    {uniqueOptions.length === 0 && (
                      <span className="text-xs text-gray-500 italic p-1">Sem valores.</span>
                    )}
                  </div>
                  
                  <div className="flex items-center justify-between border-t border-gray-50 pt-3">
                    <button
                      onClick={() => { setFilterValues(null); setPopoverOpen(false); }}
                      className="text-[9px] font-black text-gray-500 hover:text-red-500 uppercase transition-colors px-2"
                    >
                      Limpar
                    </button>
                    <button
                      onClick={() => setPopoverOpen(false)}
                      className="bg-brand-yellow text-white px-4 py-1.5 rounded-lg text-[9px] font-black uppercase hover:bg-brand-blue-hover transition-colors shadow-sm"
                    >
                      OK
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </th>
      );
  };

  return (
    <div className="space-y-6 font-['Poppins'] pb-10 relative">
      
      {/* CABEÇALHO */}
      <div className="mb-8 flex items-center justify-between px-2">
        <div className="flex items-center gap-5">
          <div className="w-14 h-14 bg-brand-yellow/10 rounded-2xl flex items-center justify-center shrink-0 text-brand-yellow">
            <FileText size={28} />
          </div>
          <div className="space-y-2">
            <div className="space-y-0.5">
              <h1 className="text-2xl font-bold text-brand-dark tracking-tight">NFSe Tomadas - <span className="text-brand-yellow font-medium">Controle Mensal</span></h1>
              <p className="text-[13px] text-gray-500 font-medium">Gestão de notas recebidas e retenções da competência.</p>
            </div>
            
            {/* AVISO DE ATUALIZAÇÃO */}
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50/80 border border-blue-100 rounded-md text-blue-600 w-max">
              <Info size={14} className="shrink-0" />
              <span className="text-[11px] font-medium tracking-tight">Base atualizada todo dia às 3h da manhã contendo apenas XMLs do Portal Nacional.</span>
            </div>
          </div>
        </div>
      </div>

      {/* FILTROS E CONTROLES */}
      <div className="flex flex-col gap-3 bg-white p-4 rounded-xl shadow-sm border border-gray-100 relative z-10 w-full">
        <div className="flex flex-col lg:flex-row items-center justify-between gap-4">
          
          <div className="flex items-center gap-2 bg-gray-50 p-1 rounded-lg border border-gray-100 w-full lg:w-auto justify-center">
            <button onClick={() => shiftMonth(-1)} className="p-1.5 text-brand-dark hover:bg-white rounded transition-all"><ChevronDown className="rotate-90" size={18} /></button>
            <div className="flex items-center gap-2 px-2">
              <Calendar size={14} className="text-brand-yellow shrink-0" />
              <DatePicker
                selected={mesano ? new Date(parseInt(mesano.substring(0, 4)), parseInt(mesano.substring(4, 6)) - 1, 1) : new Date()}
                onChange={(date: Date | null) => {
                  if (date) setMesano(`${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}`);
                }}
                dateFormat="MMMM yyyy"
                showMonthYearPicker
                locale="pt-BR"
                className="bg-transparent border-none font-bold text-xs text-brand-dark focus:ring-0 cursor-pointer uppercase w-28.75 p-0 text-center outline-none"
              />
            </div>
            <button onClick={() => shiftMonth(1)} className="p-1.5 text-brand-dark hover:bg-white rounded transition-all"><ChevronDown className="-rotate-90" size={18} /></button>
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto justify-center">
            
            <div className="relative group flex">
              <button 
                onClick={handleConversaoXML} 
                disabled={isConvertingXML}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-black text-[10px] uppercase tracking-widest transition-all whitespace-nowrap shadow-sm ${!isConvertingXML ? 'bg-indigo-50 text-indigo-600 border border-indigo-200 hover:bg-indigo-100 hover:text-indigo-700 cursor-pointer' : 'bg-gray-50 border border-gray-200 text-gray-400 cursor-not-allowed'}`}
              >
                {isConvertingXML ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
                {isConvertingXML ? 'Processando XML...' : 'Conversão XML Detalhado (Todos)'}
              </button>

              {/* TOOLTIP CUSTOMIZADO */}
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-3 bg-brand-dark text-gray-100 text-[10px] font-medium leading-relaxed rounded-xl shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 pointer-events-none text-center">
                Essa exportação lê cada XML na nuvem para montar a planilha. O processo é pesado e leva entre <strong className="text-brand-yellow">15 a 40 minutos</strong>.<br/><br/>
                <strong className="text-brand-yellow">Atenção:</strong> Você não precisa aguardar na tela. O processo rodará no servidor e o arquivo será salvo na pasta da rede automaticamente.
                
                {/* SETINHA DO TOOLTIP */}
                <div className="absolute top-full left-1/2 -translate-x-1/2 border-[5px] border-transparent border-t-brand-dark"></div>
              </div>
            </div>

            <div className="relative flex-1 lg:flex-none" ref={exportDropdownRef}>
              <button 
                onClick={() => setIsExportMenuOpen(!isExportMenuOpen)} 
                className="w-full flex items-center gap-2 px-4 py-2 rounded-lg font-black text-[10px] uppercase tracking-widest transition-all whitespace-nowrap justify-center bg-brand-dark text-white hover:text-brand-yellow shadow-sm cursor-pointer"
              >
                <Download size={14} /> Exportar <ChevronDown size={12} className={`transition-transform ${isExportMenuOpen ? 'rotate-180' : ''}`} />
              </button>
              
              {isExportMenuOpen && (
                <div className="absolute top-full left-0 lg:right-0 lg:left-auto mt-2 w-48 bg-white border border-gray-100 rounded-xl shadow-xl z-50 flex flex-col p-1 animate-in zoom-in-95 duration-100">
                  <button onClick={() => handleExportarExcel('totais-empresas')} className="flex items-center gap-2 px-3 py-2.5 text-[10px] font-black uppercase text-brand-dark hover:bg-brand-yellow/10 rounded-lg transition-colors w-full text-left">
                    Totais por Empresa
                  </button>
                  <button onClick={() => handleExportarExcel('retencoes')} className="flex items-center gap-2 px-3 py-2.5 text-[10px] font-black uppercase text-brand-dark hover:bg-brand-yellow/10 rounded-lg transition-colors w-full text-left">
                    Retenções Detalhadas
                  </button>
                </div>
              )}
            </div>

            <button 
              onClick={handleAtualizarValores} 
              disabled={isBatchProcessing || selectedCodigos.length === 0}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-black text-[10px] uppercase tracking-widest transition-all whitespace-nowrap shadow-sm ${selectedCodigos.length > 0 ? 'bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100 hover:text-blue-700 cursor-pointer' : 'bg-gray-50 border border-gray-200 text-gray-300 cursor-not-allowed'}`}
            >
              <Zap size={14} /> {isBatchProcessing ? 'Aguarde...' : 'Atualizar Valores'}
            </button>
          </div>

        </div>

        <div className="w-full h-px bg-gray-50"></div>

        <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto lg:justify-between">
          <div className="relative flex-1 lg:w-87.5 max-w-md">
            <Search className="absolute left-3 top-2.5 text-gray-500" size={16} />
            <input 
              type="text" 
              placeholder="Buscar por Empresa, Código ou CNPJ..." 
              value={busca} 
              onChange={(e) => setBusca(e.target.value)} 
              className="pl-9 pr-3 py-2 bg-gray-50 border border-transparent rounded-lg text-xs font-bold outline-none focus:bg-white focus:border-gray-200 w-full text-brand-dark transition-all" 
            />
          </div>

          {hasActiveFilters && (
            <button onClick={limparTodosOsFiltros} className="shrink-0 text-[9px] uppercase font-bold text-red-400 hover:text-red-600 px-2 transition-colors whitespace-nowrap">
              Limpar Filtros
            </button>
          )}
        </div>
      </div>

      {/* TABELA PRINCIPAL */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden relative z-0">
        <div className="overflow-x-auto custom-scrollbar pb-24 min-h-87.5">
          <table className="w-full text-left text-sm min-w-max">
            <thead>
              <tr>
                <th className="p-3 align-middle bg-brand-panel w-12 text-center border-r border-gray-50 border-b">
                  <input type="checkbox" checked={isAllSelected} onChange={handleSelectAll} disabled={tomadasFiltradas.length === 0} style={{ accentColor: '#fdb913' }} className="w-4 h-4 rounded border-gray-300 cursor-pointer" />
                </th>
                <th className="p-3 align-middle bg-brand-panel w-10 text-center border-r border-gray-50 border-b"></th>
                
                {renderTh('Cliente / Tomador', 'empresa', 'left')}
                {renderTh('Notas Válidas', 'quantidade_notas_validas', 'left')}
                
                {renderExcelTh('Total Serviço Bruto', 'total_tomadas', filtroValoresServico, setFiltroValoresServico, popoverServicoAberto, setPopoverServicoAberto, popoverServicoRef, valoresServicoUnicos, formatBRL, 'left')}
                
                {renderExcelTh('Total Retenção', 'total_retencao', filtroValoresRetencao, setFiltroValoresRetencao, popoverRetencaoAberto, setPopoverRetencaoAberto, popoverRetencaoRef, valoresRetencaoUnicos, formatBRL, 'left')}
                
                {/* COLUNA CONFERÊNCIA */}
                {renderExcelTh('Conferência', 'conferencia', filtroConferencia, setFiltroConferencia, popoverConferenciaAberto, setPopoverConferenciaAberto, popoverConferenciaRef, valoresConferenciaUnicos, (v) => v === 'conferidos' ? 'Conferidos' : 'Pendentes', 'center')}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading && tomadas.length === 0 ? (
                <tr><td colSpan={7} className="p-10 text-center text-gray-300 italic animate-pulse font-bold">Consultando dados...</td></tr>
              ) : tomadasPaginadas.length === 0 ? (
                <tr><td colSpan={7} className="p-10 text-center text-gray-500 font-bold">Nenhuma NFSe Tomada encontrada para esta competência.</td></tr>
              ) : tomadasPaginadas.map((t) => {
                
                const isExpanded = expandedRows.includes(t.cod_cliente);
                const hasRetencoes = t.notas_retencao && t.notas_retencao.length > 0;
                const isSelected = selectedCodigos.includes(t.cod_cliente);
                const infoValidacao = validados[t.cod_cliente];
                const isValidado = !!infoValidacao; 

                return (
                  <React.Fragment key={t.cod_cliente}>
                    {/* LINHA PRINCIPAL DA EMPRESA */}
                    <tr className={`hover:bg-gray-50/80 transition-colors group ${isSelected ? 'bg-yellow-50/30' : isExpanded ? 'bg-gray-50/50' : ''}`}>
                      <td className="p-3 align-top text-center border-r border-gray-50">
                        <input type="checkbox" checked={isSelected} onChange={() => handleSelectRow(t.cod_cliente)} style={{ accentColor: '#fdb913' }} className="w-4 h-4 rounded border-gray-300 cursor-pointer mt-1" />
                      </td>

                      <td className="p-3 align-middle text-center border-r border-gray-50">
                        <button 
                          onClick={() => toggleRow(t.cod_cliente)}
                          className={`p-1 rounded-lg transition-all ${hasRetencoes ? 'text-brand-yellow hover:bg-brand-yellow/10' : 'text-gray-400 hover:bg-gray-200'}`}
                        >
                          <ChevronRight size={18} className={`transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
                        </button>
                      </td>

                      <td className="p-3 align-top max-w-70">
                        <div className="flex flex-col gap-0.5">
                          <div className="font-bold text-brand-dark truncate flex items-center gap-1.5" title={t.empresa}>
                            <span className="text-brand-yellow mr-1.5 font-black">{t.cod_cliente}</span>
                            {t.empresa}

                            {/* ALERTA DE CERTIFICADO VENCIDO/AUSENTE */}
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

                          </div>
                          <div className="text-[12px] font-bold text-gray-500 font-mono tracking-tighter">
                            {formatCNPJ(t.cnpj)}
                          </div>
                        </div>
                      </td>

                      <td className="p-3 align-top">
                        <div className="flex flex-col">
                          <span className="font-medium text-gray-600 text-sm">{t.quantidade_notas_validas} Válidas</span>
                          {t.quantidade_canceladas > 0 && (
                            <span className="text-[10px] font-bold text-red-500 mt-0.5">{t.quantidade_canceladas} Canceladas</span>
                          )}
                        </div>
                      </td>

                      <td className="p-3 align-top">
                        <div className="flex flex-col min-w-27.5">
                          <span className="font-bold text-brand-dark text-sm">{formatBRL(t.total_tomadas)}</span>
                          <span className="text-[9px] text-gray-500 mt-0.5 uppercase tracking-widest">
                            Atualizado: {formatData(t.updated_at)}
                          </span>
                        </div>
                      </td>

                      <td className="p-3 align-top">
                        <div className="flex flex-col">
                          <span className={`font-bold text-sm ${t.total_retencao > 0 ? 'text-red-500' : 'text-gray-500'}`}>
                            {formatBRL(t.total_retencao)}
                          </span>
                          {hasRetencoes && (
                            <span className="text-[9px] text-gray-500 mt-0.5 uppercase tracking-widest">{t.quantidade_retencao} Notas com Retenção</span>
                          )}
                        </div>
                      </td>

                      {/* --- COLUNA DE AÇÃO DE CONFERÊNCIA MANUAL --- */}
                      <td className="p-3 align-middle text-center border-l border-gray-50">
                        <div className="flex flex-col items-center justify-center gap-1 min-w-12.5">
                          <button 
                            onClick={() => toggleValidado(t.cod_cliente)}
                            title={isValidado ? "Desfazer conferência" : "Marcar como conferido"}
                            className={`p-1.5 rounded-lg transition-all ${
                              isValidado 
                                ? 'bg-green-50 text-green-500 hover:bg-green-100 hover:text-green-600 border border-green-200' 
                                : 'bg-gray-50 text-gray-300 hover:bg-gray-100 hover:text-gray-500 border border-gray-200'
                            }`}
                          >
                            <CheckCircle2 size={16} className={isValidado ? 'fill-green-100' : ''} />
                          </button>
                          
                          {isValidado && (
                            <div className="flex flex-col items-center leading-[1.1]">
                              <span className="text-[8px] font-black text-gray-500 uppercase truncate max-w-16.25" title={infoValidacao.user}>
                                {infoValidacao.user}
                              </span>
                              <span className="text-[8px] font-medium text-gray-500">
                                {infoValidacao.date}
                              </span>
                            </div>
                          )}
                        </div>
                      </td>

                    </tr>

                    {/* LINHA EXPANDIDA (NOTAS COM RETENÇÃO) */}
                    {isExpanded && (
                      <tr className="bg-gray-50/30">
                        <td colSpan={7} className="p-0 border-b border-gray-100">
                          <div className="p-4 pl-14 animate-in slide-in-from-top-2 duration-200">
                            <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                              <div className="bg-brand-panel px-4 py-2 border-b border-gray-100 flex items-center justify-between">
                                <span className="text-[10px] font-black uppercase tracking-widest text-brand-dark flex items-center gap-2">
                                  <FileText size={12} className={hasRetencoes ? "text-brand-yellow" : "text-gray-400"} />
                                  Detalhamento de Retenções ({t.notas_retencao?.length || 0})
                                </span>
                              </div>
                              
                              {hasRetencoes ? (
                                <div className="overflow-x-auto custom-scrollbar">
                                  <table className="w-full text-left text-xs">
                                    <thead className="bg-gray-50">
                                      <tr>
                                        <th className="px-4 py-2 font-black uppercase text-[9px] text-gray-500 tracking-widest">Nº NFSe</th>
                                        <th className="px-4 py-2 font-black uppercase text-[9px] text-gray-500 tracking-widest">Emitente</th>
                                        <th className="px-4 py-2 font-black uppercase text-[9px] text-gray-500 tracking-widest">Competência</th>
                                        <th className="px-4 py-2 font-black uppercase text-[9px] text-gray-500 tracking-widest">Cód. Serv</th>
                                        <th className="px-4 py-2 font-black uppercase text-[9px] text-gray-500 tracking-widest">Trib / Tip. Ret</th>
                                        <th className="px-4 py-2 font-black uppercase text-[9px] text-gray-500 tracking-widest text-right">Vlr. Serviço</th>
                                        <th className="px-4 py-2 font-black uppercase text-[9px] text-gray-500 tracking-widest text-right">Vlr. Retenção</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-50">
                                      {t.notas_retencao.map((nota, nIdx) => (
                                        <tr key={nIdx} className="hover:bg-gray-50/80 transition-colors">
                                          <td className="px-4 py-3 font-bold text-brand-dark">
                                            {nota.numero_nfse}
                                          </td>
                                          <td className="px-4 py-3">
                                            <div className="flex flex-col max-w-48">
                                              <span className="font-bold text-gray-700 truncate" title={nota.emit_nome}>{nota.emit_nome}</span>
                                              <span className="text-[11px] text-gray-500 font-mono tracking-tighter">{formatCNPJ(nota.emit_cnpj)}</span>
                                            </div>
                                          </td>
                                          <td className="px-4 py-3 text-gray-500 text-[11px] font-bold">
                                            {formatDataSimples(nota.data_competencia)}
                                          </td>
                                          <td className="px-4 py-3 text-gray-500 text-[12px]">
                                            {nota.codigo_servico}
                                          </td>
                                          <td className="px-4 py-3">
                                            <div className="flex gap-2">
                                              <span className="px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded text-[10px] font-bold" title="Tributação ISSQN">T: {nota.trib_issqn}</span>
                                              <span className="px-1.5 py-0.5 bg-red-50 text-red-500 rounded text-[10px] font-bold" title="Tipo Retenção ISSQN">R: {nota.tp_ret_issqn}</span>
                                            </div>
                                          </td>
                                          <td className="px-4 py-3 text-right font-medium text-gray-600">
                                            {formatBRL(nota.valor_servico)}
                                          </td>
                                          <td className="px-4 py-3 text-right font-bold text-red-500">
                                            {formatBRL(nota.valor_retencao)}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              ) : (
                                <div className="p-6 text-center text-gray-400 font-bold text-xs uppercase tracking-widest">
                                  Nenhuma nota com retenção para esta empresa no período.
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* --- RODAPÉ DE PAGINAÇÃO --- */}
        {!loading && tomadasFiltradas.length > 0 && (
          <div className="absolute bottom-0 left-0 w-full bg-white border-t border-gray-100 p-4 flex items-center justify-between text-[10px] font-black text-gray-500 uppercase tracking-widest rounded-b-xl z-20 shadow-[0_-10px_20px_rgba(0,0,0,0.02)]">
            <div>Mostrando <span className="text-brand-dark">{indexInicio + 1} - {Math.min(indexInicio + itensPorPagina, tomadasFiltradas.length)}</span> de {tomadasFiltradas.length}</div>
            <div className="flex items-center gap-3">
              <button onClick={() => setPaginaAtual(prev => Math.max(prev - 1, 1))} disabled={paginaAtual === 1} className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-20 transition-all text-brand-dark"><ChevronLeft size={16} /></button>
              <span className="text-brand-dark font-black">Pág {paginaAtual} / {totalPaginas}</span>
              <button onClick={() => setPaginaAtual(prev => Math.min(prev + 1, totalPaginas))} disabled={paginaAtual === totalPaginas} className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-20 transition-all text-brand-dark"><ChevronRight size={16} /></button>
            </div>
          </div>
        )}
      </div>

      {/* --- NOVO MODAL CUSTOMIZADO --- */}
      {modalAviso.isOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-60 p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-[25px] shadow-2xl w-full max-w-sm overflow-hidden flex flex-col border border-gray-100 animate-in zoom-in-95 duration-200">
            <div className="bg-brand-dark px-6 py-4 flex items-center justify-between border-b-4 border-brand-yellow">
              <div className="flex items-center gap-2 text-white">
                <FileText size={20} className="text-brand-yellow" />
                <h2 className="font-bold text-lg tracking-tight">{modalAviso.titulo}</h2>
              </div>
              <button onClick={() => setModalAviso({isOpen: false, titulo: '', mensagem: ''})} className="text-gray-500 hover:text-white transition-colors">
                <X size={22} />
              </button>
            </div>
            <div className="p-8 space-y-6 text-center flex flex-col items-center">
              <p className="text-brand-dark text-sm font-bold leading-relaxed whitespace-pre-wrap">{modalAviso.mensagem}</p>
              <button 
                onClick={() => setModalAviso({isOpen: false, titulo: '', mensagem: ''})} 
                className="w-full px-4 py-3 bg-brand-dark text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:text-brand-yellow transition-all shadow-md"
              >
                Entendi
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; height: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: #f1f1f1; border-radius: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 4px; }
      `}</style>
    </div>
  );
};