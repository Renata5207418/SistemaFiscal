import React, { useEffect, useState, useCallback, useRef } from 'react';
import api from '../services/api';
import {
  RefreshCw, ChevronLeft, ChevronRight,
  Search, Calendar, Loader2, Download, DollarSign, AlertTriangle, 
  Filter, ChevronUp, ChevronDown, ChevronsUpDown, CheckCircle2, X, Info
} from 'lucide-react';
import * as XLSX from 'xlsx';

// --- IMPORTAÇÕES PARA DATA EM PORTUGUÊS ---
import DatePicker, { registerLocale } from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { ptBR } from "date-fns/locale"; 

registerLocale("pt-BR", ptBR);
// ------------------------------------------

interface FaturaRN {
  cod: number;
  grupo: string;
  cnpj: string;
  empresa: string;
  regime: string;
  ultima: string;
  total: number;
  dominio: number;
  diferenca: number;
  apuracao: string;
  conferencia?: { status: boolean; user: string; date: string };
  cert_status?: string;   
  cert_validade?: string;
  cTribNac?: string[];
}

type SortConfig = {
  key: keyof FaturaRN;
  direction: 'asc' | 'desc';
} | null;

export const RegimeNormal: React.FC = () => {
  const [faturas, setFaturas] = useState<FaturaRN[]>([]);
  const [busca, setBusca] = useState('');
  const [sortConfig, setSortConfig] = useState<SortConfig>(null);
  const [loading, setLoading] = useState(false);
  const [filtroDifFaturamento, setFiltroDifFaturamento] = useState(false);
  const [selectedCodigos, setSelectedCodigos] = useState<number[]>([]);
  const [confirmModal, setConfirmModal] = useState<{ isOpen: boolean; message: string }>({ isOpen: false, message: '' });
  
  // --- ESTADOS PARA O FILTRO DE DOMÍNIO ---
  const [filtroValoresDominio, setFiltroValoresDominio] = useState<number[] | null>(null);
  const [popoverDominioAberto, setPopoverDominioAberto] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // --- ESTADOS PARA O FILTRO DE XML (TOTAL) ---
  const [filtroValoresTotal, setFiltroValoresTotal] = useState<number[] | null>(null);
  const [popoverTotalAberto, setPopoverTotalAberto] = useState(false);
  const popoverTotalRef = useRef<HTMLDivElement>(null);

  // --- ESTADOS PARA O FILTRO DE STATUS APURAÇÃO ---
  const [filtroStatus, setFiltroStatus] = useState<string[] | null>(null);
  const [popoverStatusAberto, setPopoverStatusAberto] = useState(false);
  const popoverStatusRef = useRef<HTMLDivElement>(null);

  // --- ESTADOS PARA O FILTRO DE CONFERÊNCIA ---
  const [filtroConferencia, setFiltroConferencia] = useState<string[] | null>(null);
  const [popoverConferenciaAberto, setPopoverConferenciaAberto] = useState(false);
  const popoverConferenciaRef = useRef<HTMLDivElement>(null);

  // --- ESTADOS PARA O FILTRO DE CÓD. TRIB. ---
  const [filtroTribNac, setFiltroTribNac] = useState<string[] | null>(null);
  const [popoverTribNacAberto, setPopoverTribNacAberto] = useState(false);
  const popoverTribNacRef = useRef<HTMLDivElement>(null);

  // Fecha os popovers ao clicar fora deles
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setPopoverDominioAberto(false);
      }
      if (popoverTotalRef.current && !popoverTotalRef.current.contains(event.target as Node)) {
        setPopoverTotalAberto(false);
      }
      if (popoverStatusRef.current && !popoverStatusRef.current.contains(event.target as Node)) {
        setPopoverStatusAberto(false);
      }
      if (popoverConferenciaRef.current && !popoverConferenciaRef.current.contains(event.target as Node)) {
        setPopoverConferenciaAberto(false);
      }
      if (popoverTribNacRef.current && !popoverTribNacRef.current.contains(event.target as Node)) {
        setPopoverTribNacAberto(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Estado sincronizado com o Banco de Dados
  const [validados, setValidados] = useState<Record<number, { date: string, user: string }>>({});

  const [mesano, setMesano] = useState(() => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  const [paginaAtual, setPaginaAtual] = useState(1);
  const itensPorPagina = 10;

  // Função para salvar conferência no Backend
  const toggleValidado = async (cod: number) => {
    try {
      const mesFormatado = mesano.replace('-', '');
      const { data } = await api.post('/automacao/conferencia/toggle', {
        cod_cliente: cod,
        mesano: mesFormatado
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
      console.error("Erro ao salvar conferência", error);
      setConfirmModal({ isOpen: true, message: "Erro ao salvar conferência no banco de dados." });
    }
  };

  const formatBRL = (v: number) =>
    (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  const formatCNPJ = (cnpjRaw: any) => {
    if (!cnpjRaw) return '—';
    const num = String(cnpjRaw).replace(/\D/g, '');
    if (num.length === 14) {
      return num.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
    }
    return String(cnpjRaw) || '—';
  };

  const formatData = (iso: string) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth()+1).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  };

  const fetchData = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const mesFormatado = mesano.replace('-', '');
      const { data } = await api.get(`/automacao/painel-geral-rn?mesano=${mesFormatado}`);
      
      if (data.faturas) {
        const faturasFormatadas = data.faturas.map((f: any) => ({
            ...f,
            cnpj: formatCNPJ(f.cnpj),
            ultima: formatData(f.ultima)
        }));
        setFaturas(faturasFormatadas);

        // Preenche o estado de conferidos vindo do Banco
        const novosValidados: Record<number, { date: string, user: string }> = {};
        data.faturas.forEach((f: any) => {
            if (f.conferencia && f.conferencia.status) {
                novosValidados[f.cod] = { date: f.conferencia.date, user: f.conferencia.user };
            }
        });
        setValidados(novosValidados);
      } else {
        setFaturas([]);
        setValidados({});
      }
    } catch (err) {
      console.error("Erro ao buscar faturas:", err);
      setFaturas([]);
      setValidados({});
    } finally {
      setLoading(false);
    }
  }, [mesano]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSort = (key: keyof FaturaRN) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const handleRecalcularXML = (codigos: number[]) => {
    if (codigos.length === 0) return;
    
    setConfirmModal({ 
      isOpen: true, 
      message: `Enfileirando a atualização de faturamento XML para ${codigos.length} empresa(s).\nO recálculo na AWS S3 iniciará em segundo plano.` 
    });

    setTimeout(async () => {
      for (const cod of codigos) {
        try {
          await api.post(`/automacao/agenda-xml/${cod}`, { mesano: mesano.replace('-', '') });
        } catch (err) {
          console.error(`Erro ao agendar atualização XML para a empresa ${cod}`, err);
        }
      }
      setTimeout(() => fetchData(false), 3000);
    }, 100);

    setSelectedCodigos([]);
  };

  const shiftMonth = (delta: number) => {
    const [y, m] = mesano.split('-').map(Number);
    const newDate = new Date(y, m - 1 + delta, 1);
    setMesano(`${newDate.getFullYear()}-${String(newDate.getMonth()+1).padStart(2,"0")}`);
  };

  const limparFiltros = () => {
    setBusca('');
    setFiltroDifFaturamento(false);
    setSortConfig(null);
    setPaginaAtual(1);
    setSelectedCodigos([]);
    setFiltroValoresDominio(null); 
    setFiltroValoresTotal(null); 
    setFiltroStatus(null);
    setFiltroConferencia(null);
    setFiltroTribNac(null);
  };

  // Extrai os valores únicos para os checkboxes
  const valoresDominioUnicos = Array.from(new Set(faturas.map(f => f.dominio))).sort((a, b) => a - b);
  const valoresTotalUnicos = Array.from(new Set(faturas.map(f => f.total))).sort((a, b) => a - b);
  const valoresStatusUnicos = Array.from(new Set(faturas.map(f => f.apuracao))).sort();
  const valoresConferenciaUnicos = ['vistos', 'pendentes']; // Valores fixos para conferência

  // Extrai todos os códigos únicos (e inclui o '-' para empresas sem código)
  const valoresTribNacUnicos = Array.from(new Set(
    faturas.flatMap(f => (Array.isArray(f.cTribNac) && f.cTribNac.length > 0) ? f.cTribNac : ['-'])
  )).sort();

  // <-- FILTROS COMBINADOS -->
  let faturasFiltradas = faturas.filter(f => {
    const matchesBusca = f.empresa.toLowerCase().includes(busca.toLowerCase()) || 
                         String(f.cod).includes(busca) || 
                         f.cnpj.includes(busca);
    
    const matchesDif = !filtroDifFaturamento || Math.abs(f.diferenca) >= 0.01;

    const matchesDominio = filtroValoresDominio === null || filtroValoresDominio.includes(f.dominio);
    const matchesTotal = filtroValoresTotal === null || filtroValoresTotal.includes(f.total);
    const matchesStatus = filtroStatus === null || filtroStatus.includes(f.apuracao);
    
    const matchesConferencia = filtroConferencia === null ||
                         (filtroConferencia.includes('vistos') && !!validados[f.cod]) ||
                         (filtroConferencia.includes('pendentes') && !validados[f.cod]);

    const matchesTribNac = filtroTribNac === null || 
      (Array.isArray(f.cTribNac) && f.cTribNac.length > 0 
        ? f.cTribNac.some(cod => filtroTribNac.includes(cod))
        : filtroTribNac.includes('-'));

    return matchesBusca && matchesDif && matchesDominio && matchesTotal && matchesStatus && matchesConferencia && matchesTribNac;
  });

  if (sortConfig !== null) {
    faturasFiltradas.sort((a: any, b: any) => {
      if (a[sortConfig.key] < b[sortConfig.key]) return sortConfig.direction === 'asc' ? -1 : 1;
      if (a[sortConfig.key] > b[sortConfig.key]) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }

  useEffect(() => {
    setPaginaAtual(1);
  }, [busca, filtroDifFaturamento, filtroValoresDominio, filtroValoresTotal, filtroStatus, filtroConferencia]);

  const totalPaginas = Math.max(1, Math.ceil(faturasFiltradas.length / itensPorPagina));
  const indexInicio = (paginaAtual - 1) * itensPorPagina;
  const paginadas = faturasFiltradas.slice(indexInicio, indexInicio + itensPorPagina);

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.target.checked ? setSelectedCodigos(faturasFiltradas.map(f => f.cod)) : setSelectedCodigos([]);
  };

  const handleSelectRow = (cod: number) => {
    setSelectedCodigos(prev => prev.includes(cod) ? prev.filter(c => c !== cod) : [...prev, cod]);
  };

  const renderSortableTh = (label: string, sortKey: keyof FaturaRN, align: 'left' | 'center' = 'left') => {
    const isActive = sortConfig?.key === sortKey;
    return (
      <th 
        className={`p-4 text-[10px] font-black uppercase text-gray-500 tracking-widest cursor-pointer hover:bg-gray-100 transition-colors group select-none`}
        onClick={() => handleSort(sortKey)}
      >
        <div className={`flex items-center gap-1.5 ${align === 'center' ? 'justify-center' : 'justify-start'}`}>
          {label}
          <div className="flex flex-col text-gray-300">
            {isActive ? (
              sortConfig.direction === 'asc' ? <ChevronUp size={12} className="text-brand-yellow" /> : <ChevronDown size={12} className="text-brand-yellow" />
            ) : (
              <ChevronsUpDown size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />
            )}
          </div>
        </div>
      </th>
    );
  };

  const exportarExcel = () => {
    if (faturasFiltradas.length === 0) return alert("Nenhum dado para exportar.");
    
    const dados = faturasFiltradas.map(f => {
      const diferencaArredondada = Math.abs(f.diferenca) < 0.001 ? 0 : f.diferenca;

      return {
        "CÓD": f.cod,
        "GRUPO": f.grupo,
        "CNPJ": f.cnpj,
        "EMPRESA": f.empresa,
        "REGIME TRIBUTÁRIO": f.regime,
        "VALOR TOTAL": f.total,
        "VALOR DOMÍNIO": f.dominio,
        "DIFERENÇA": diferencaArredondada, 
        "CÓD. TRIB.": f.cTribNac && f.cTribNac.length > 0 ? f.cTribNac.join(', ') : '-',
        "ÚLTIMA ATUALIZAÇÃO": f.ultima,
        "APURADO": f.apuracao,
        "CONFERIDO": validados[f.cod] ? 'Sim' : 'Não',
        "DATA CONFERÊNCIA": validados[f.cod] ? validados[f.cod].date : '-',
        "USUÁRIO CONFERÊNCIA": validados[f.cod] ? validados[f.cod].user : '-'
      };
    });

    const ws = XLSX.utils.json_to_sheet(dados);

    const range = XLSX.utils.decode_range(ws['!ref']!!);
    for (let R = range.s.r + 1; R <= range.e.r; ++R) {
      const colunasFinanceiras = [5, 6, 7]; 
      colunasFinanceiras.forEach(C => {
        const cell_address = { c: C, r: R };
        const cell_ref = XLSX.utils.encode_cell(cell_address);
        if (ws[cell_ref]) {
          ws[cell_ref].t = 'n'; 
          ws[cell_ref].z = '#,##0.00'; 
        }
      });
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Regime Normal");
    XLSX.writeFile(wb, `Regime_Normal_${mesano}.xlsx`);
  };

  // --- CÁLCULOS DA BARRA DE PROGRESSO ---
  const totalGeral = faturas.length;
  const apuradasGeral = faturas.filter(f => f.apuracao === 'Sim').length;
  const pendentesGeral = totalGeral - apuradasGeral;
  
  let percentualApuracao = totalGeral > 0 ? Math.floor((apuradasGeral / totalGeral) * 100) : 0;
  
  if (apuradasGeral > 0 && apuradasGeral < totalGeral && percentualApuracao === 100) {
    percentualApuracao = 99;
  }
  // --------------------------------------

  return (
    <div className="space-y-6 font-['Poppins'] pb-10">

      {/* CABEÇALHO */}
      <div className="mb-8 flex items-center gap-5 px-2">
        <div className="w-14 h-14 bg-brand-yellow/10 rounded-2xl flex items-center justify-center shrink-0 text-brand-yellow">
          <DollarSign size={28} />
        </div>
        <div className="space-y-2">
          <div className="space-y-0.5">
            <h1 className="text-2xl font-bold text-brand-dark tracking-tight">
              Controle Mensal - <span className="text-brand-yellow font-medium">Regime Normal</span>
            </h1>
            <p className="text-[13px] text-gray-500 font-medium">
              Monitoramento para Lucro Real e Presumido.
            </p>
          </div>
          
          {/* AVISO DE ATUALIZAÇÃO */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50/80 border border-blue-100 rounded-md text-blue-600 w-max">
            <Info size={14} className="shrink-0" />
            <span className="text-[11px] font-medium tracking-tight">Base atualizada todo dia às 3h da manhã contendo apenas XMLs do Portal Nacional.</span>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4 bg-white p-5 rounded-xl shadow-sm border border-gray-100 relative z-10 w-full">
        
        {/* FILTROS E BOTÕES SUPERIORES */}
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 bg-gray-50 p-1.5 rounded-lg border border-gray-100">
            <button onClick={() => shiftMonth(-1)} className="p-2 text-brand-dark hover:bg-white rounded transition-all shadow-sm shadow-transparent hover:shadow-gray-200"><ChevronLeft size={18} /></button>
            <div className="flex items-center gap-2 px-3">
              <Calendar size={14} className="text-brand-yellow shrink-0" />
              <DatePicker
                selected={new Date(parseInt(mesano.split('-')[0]), parseInt(mesano.split('-')[1]) - 1, 1)}
                onChange={(date: Date | null) => {
                  if (date) {
                    setMesano(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`);
                  }
                }}
                dateFormat="MMMM yyyy"
                showMonthYearPicker
                locale="pt-BR"
                className="bg-transparent border-none font-black text-xs text-brand-dark focus:ring-0 cursor-pointer uppercase w-32 p-0 text-center outline-none"
              />
            </div>
            <button onClick={() => shiftMonth(1)} className="p-2 text-brand-dark hover:bg-white rounded transition-all shadow-sm shadow-transparent hover:shadow-gray-200"><ChevronRight size={18} /></button>
          </div>

          <div className="flex items-center gap-3 w-full md:w-auto">
            <button 
              onClick={() => handleRecalcularXML(selectedCodigos)} 
              disabled={loading || selectedCodigos.length === 0} 
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-black text-[10px] uppercase tracking-widest transition-all whitespace-nowrap flex-1 lg:flex-none justify-center ${selectedCodigos.length > 0 ? 'bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100 hover:text-blue-700 shadow-sm cursor-pointer' : 'bg-gray-50 border border-gray-200 text-gray-300 cursor-not-allowed'}`}
            >
              <RefreshCw size={14} /> Atualizar Faturamento
            </button>

            <button onClick={() => fetchData()} className="flex items-center justify-center shrink-0 w-10 h-10 bg-gray-50 text-brand-dark rounded-xl hover:bg-gray-100 border border-gray-100 transition-all">
              <RefreshCw size={16} className={loading ? 'animate-spin text-brand-yellow' : ''} />
            </button>
            
            <button onClick={exportarExcel} className="flex-1 md:flex-none flex items-center justify-center gap-2 bg-brand-dark text-white px-6 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-widest hover:text-brand-yellow transition-all shadow-sm">
              <Download size={14} /> EXCEL
            </button>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row items-center gap-4">
          <div className="relative flex-1 w-full">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500" size={16} />
            <input 
              type="text" 
              placeholder="Buscar por Empresa, Código ou CNPJ..." 
              value={busca} 
              onChange={(e) => setBusca(e.target.value)} 
              className="pl-10 pr-4 py-2.5 bg-gray-50 border border-transparent rounded-xl text-xs font-bold outline-none focus:bg-white focus:border-gray-200 w-full text-brand-dark transition-all" 
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
            <button 
              onClick={() => setFiltroDifFaturamento(!filtroDifFaturamento)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border flex-1 lg:flex-none justify-center ${
                filtroDifFaturamento ? 'bg-red-50 border-red-200 text-red-600' : 'bg-gray-50 border-transparent text-gray-500 hover:bg-gray-100'
              }`}
            >
              <AlertTriangle size={13} /> Dif. Fat
            </button>

            {/* BOTAO LIMPAR FILTROS GERAIS  */}
            {(busca || filtroDifFaturamento || filtroValoresDominio !== null || filtroValoresTotal !== null || filtroStatus !== null || filtroConferencia !== null || sortConfig) && (
              <button onClick={limparFiltros} className="text-[9px] uppercase font-black text-red-400 hover:text-red-600 px-2 transition-colors">
                Limpar
              </button>
            )}
          </div>
        </div>
      </div>

      {/* --- BARRA DE PROGRESSO DE APURAÇÃO --- */}
      {!loading && totalGeral > 0 && (
        <div className={`flex items-center justify-between p-3 rounded-xl border ${percentualApuracao === 100 ? 'bg-green-50/50 border-green-200 text-green-700' : 'bg-yellow-50 border-brand-yellow text-yellow-700'} shadow-sm relative z-0 transition-colors`}>
          <div className="flex items-center gap-3">
            <div className={`w-6 h-6 rounded-full border flex items-center justify-center shrink-0 ${percentualApuracao === 100 ? 'border-green-400 text-green-600 bg-green-100' : 'border-brand-yellow text-yellow-500 bg-white'}`}>
              <Info size={14} />
            </div>
            <div className="text-[13px] font-medium tracking-tight">
              {percentualApuracao === 100 ? (
                <span><strong>Nenhuma empresa pendente</strong> de apuração nesta competência. O ciclo está completo.</span>
              ) : (
                <span><strong className="text-yellow-700 bg-white px-1.5 py-0.5 rounded border border-brand-yellow mr-1">{pendentesGeral}</strong> Empresas pendentes de apuração do total de <strong>{totalGeral}</strong>.</span>
              )}
            </div>
          </div>
          
          <div className="flex items-center gap-4 w-1/4" style={{ minWidth: '200px' }}>
             <div className="w-full bg-yellow-100/50 h-2.5 rounded-full overflow-hidden border border-yellow-400/50">
               <div 
                 className={`h-full rounded-full transition-all duration-1000 ${percentualApuracao === 100 ? 'bg-green-500' : 'bg-brand-yellow'}`}
                 style={{ width: `${percentualApuracao}%` }}
               ></div>
             </div>
             <span className={`text-[13px] font-black w-9 text-right ${percentualApuracao === 100 ? 'text-green-600' : 'text-yellow-700'}`}>
               {percentualApuracao}%
             </span>
          </div>
        </div>
      )}

      {/* TABELA DE DADOS */}
      <div className="bg-white rounded-[20px] shadow-sm border border-gray-100 overflow-hidden relative">
        <div className="overflow-x-auto min-h-80">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-brand-panel/50">
                <th className="p-3 align-middle bg-brand-panel w-12 text-center border-r border-gray-50">
                  <input type="checkbox" checked={faturasFiltradas.length > 0 && selectedCodigos.length === faturasFiltradas.length} onChange={handleSelectAll} disabled={faturasFiltradas.length === 0} style={{ accentColor: '#fdb913' }} className="w-4 h-4 rounded border-gray-300 cursor-pointer" />
                </th>
                
                {renderSortableTh('Cliente', 'empresa')}
                
                {/* --- CABEÇALHO CUSTOMIZADO DO XML PORTAL --- */}
                <th className="p-4 relative">
                  <div className="flex items-center gap-1.5 justify-start text-[10px] font-black uppercase text-gray-500 tracking-widest select-none group">
                    <span className="cursor-pointer hover:text-gray-600 transition-colors" onClick={() => handleSort('total')}>
                      XML Portal
                    </span>
                    
                    <div className="flex flex-col text-gray-300 cursor-pointer" onClick={() => handleSort('total')}>
                      {sortConfig?.key === 'total' ? (
                        sortConfig.direction === 'asc' ? <ChevronUp size={12} className="text-brand-yellow" /> : <ChevronDown size={12} className="text-brand-yellow" />
                      ) : (
                        <ChevronsUpDown size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                      )}
                    </div>

                    <div ref={popoverTotalRef} className="relative ml-1">
                      <button 
                        onClick={() => setPopoverTotalAberto(!popoverTotalAberto)}
                        className={`p-1 rounded transition-colors ${filtroValoresTotal !== null ? 'bg-blue-50 text-brand-yellow' : 'text-gray-300 hover:text-gray-500 hover:bg-gray-100'}`}
                      >
                        <Filter size={12} className={filtroValoresTotal !== null ? 'fill-brand-yellow/20' : ''} />
                      </button>

                      {popoverTotalAberto && (
                        <div className="absolute top-full left-0 mt-2 bg-white border border-gray-100 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.1)] rounded-xl p-3 z-50 w-56 text-left normal-case tracking-normal">
                          <div className="max-h-48 overflow-y-auto custom-scrollbar flex flex-col gap-1.5 mb-3 pr-1">
                            
                            <label className="flex items-center gap-2 cursor-pointer text-[11px] font-black text-brand-dark hover:bg-gray-100 p-1.5 rounded transition-colors border-b border-gray-100 pb-2 mb-1">
                              <input
                                type="checkbox"
                                checked={filtroValoresTotal === null || filtroValoresTotal.length === valoresTotalUnicos.length}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setFiltroValoresTotal(null); 
                                  } else {
                                    setFiltroValoresTotal([]); 
                                  }
                                }}
                                className="rounded border-gray-300 w-3.5 h-3.5"
                                style={{ accentColor: '#fdb913' }}
                              />
                              (Selecionar Tudo)
                            </label>

                            {valoresTotalUnicos.map(val => {
                              const isChecked = filtroValoresTotal === null || filtroValoresTotal.includes(val);
                              return (
                                <label key={`total-${val}`} className="flex items-center gap-2 cursor-pointer text-[11px] font-medium text-brand-dark hover:bg-gray-50 p-1.5 rounded transition-colors">
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setFiltroValoresTotal([...(filtroValoresTotal || []), val]);
                                      } else {
                                        const curr = filtroValoresTotal === null ? valoresTotalUnicos : filtroValoresTotal;
                                        setFiltroValoresTotal(curr.filter(v => v !== val));
                                      }
                                    }}
                                    className="rounded border-gray-300 w-3.5 h-3.5"
                                    style={{ accentColor: '#fdb913' }}
                                  />
                                  {formatBRL(val)}
                                </label>
                              );
                            })}
                            {valoresTotalUnicos.length === 0 && (
                              <span className="text-xs text-gray-500 italic p-1">Sem valores.</span>
                            )}
                          </div>
                          
                          <div className="flex items-center justify-between border-t border-gray-50 pt-3">
                            <button
                              onClick={() => {
                                setFiltroValoresTotal(null);
                                setPopoverTotalAberto(false);
                              }}
                              className="text-[9px] font-black text-gray-500 hover:text-red-500 uppercase transition-colors px-2"
                            >
                              Limpar
                            </button>
                            <button
                              onClick={() => setPopoverTotalAberto(false)}
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

                {/* --- CABEÇALHO CUSTOMIZADO DO SYBASE DOMÍNIO --- */}
                <th className="p-4 relative">
                  <div className="flex items-center gap-1.5 justify-start text-[10px] font-black uppercase text-gray-500 tracking-widest select-none group">
                    <span className="cursor-pointer hover:text-gray-600 transition-colors" onClick={() => handleSort('dominio')}>
                      Sybase Domínio
                    </span>
                    
                    <div className="flex flex-col text-gray-300 cursor-pointer" onClick={() => handleSort('dominio')}>
                      {sortConfig?.key === 'dominio' ? (
                        sortConfig.direction === 'asc' ? <ChevronUp size={12} className="text-brand-yellow" /> : <ChevronDown size={12} className="text-brand-yellow" />
                      ) : (
                        <ChevronsUpDown size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                      )}
                    </div>

                    <div ref={popoverRef} className="relative ml-1">
                      <button 
                        onClick={() => setPopoverDominioAberto(!popoverDominioAberto)}
                        className={`p-1 rounded transition-colors ${filtroValoresDominio !== null ? 'bg-blue-50 text-brand-yellow' : 'text-gray-300 hover:text-gray-500 hover:bg-gray-100'}`}
                      >
                        <Filter size={12} className={filtroValoresDominio !== null ? 'fill-brand-yellow/20' : ''} />
                      </button>

                      {popoverDominioAberto && (
                        <div className="absolute top-full left-0 mt-2 bg-white border border-gray-100 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.1)] rounded-xl p-3 z-50 w-56 text-left normal-case tracking-normal">
                          <div className="max-h-48 overflow-y-auto custom-scrollbar flex flex-col gap-1.5 mb-3 pr-1">
                            
                            <label className="flex items-center gap-2 cursor-pointer text-[11px] font-black text-brand-dark hover:bg-gray-100 p-1.5 rounded transition-colors border-b border-gray-100 pb-2 mb-1">
                              <input
                                type="checkbox"
                                checked={filtroValoresDominio === null || filtroValoresDominio.length === valoresDominioUnicos.length}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setFiltroValoresDominio(null);
                                  } else {
                                    setFiltroValoresDominio([]);
                                  }
                                }}
                                className="rounded border-gray-300 w-3.5 h-3.5"
                                style={{ accentColor: '#fdb913' }}
                              />
                              (Selecionar Tudo)
                            </label>

                            {valoresDominioUnicos.map(val => {
                              const isChecked = filtroValoresDominio === null || filtroValoresDominio.includes(val);
                              return (
                                <label key={`dom-${val}`} className="flex items-center gap-2 cursor-pointer text-[11px] font-medium text-brand-dark hover:bg-gray-50 p-1.5 rounded transition-colors">
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setFiltroValoresDominio([...(filtroValoresDominio || []), val]);
                                      } else {
                                        const curr = filtroValoresDominio === null ? valoresDominioUnicos : filtroValoresDominio;
                                        setFiltroValoresDominio(curr.filter(v => v !== val));
                                      }
                                    }}
                                    className="rounded border-gray-300 w-3.5 h-3.5"
                                    style={{ accentColor: '#fdb913' }}
                                  />
                                  {formatBRL(val)}
                                </label>
                              );
                            })}
                            {valoresDominioUnicos.length === 0 && (
                              <span className="text-xs text-gray-500 italic p-1">Sem valores.</span>
                            )}
                          </div>
                          
                          <div className="flex items-center justify-between border-t border-gray-50 pt-3">
                            <button
                              onClick={() => {
                                setFiltroValoresDominio(null);
                                setPopoverDominioAberto(false);
                              }}
                              className="text-[9px] font-black text-gray-500 hover:text-red-500 uppercase transition-colors px-2"
                            >
                              Limpar
                            </button>
                            <button
                              onClick={() => setPopoverDominioAberto(false)}
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

                {/* --- CABEÇALHO CUSTOMIZADO DO CÓD. TRIB. --- */}
                <th className="p-4 relative">
                  <div className="flex items-center gap-1.5 justify-center text-[10px] font-black uppercase text-gray-500 tracking-widest select-none group">
                    <span className="cursor-pointer hover:text-gray-600 transition-colors" onClick={() => handleSort('cTribNac')}>
                      Cód. Trib.
                    </span>
                    
                    <div className="flex flex-col text-gray-300 cursor-pointer" onClick={() => handleSort('cTribNac')}>
                      {sortConfig?.key === 'cTribNac' ? (
                        sortConfig.direction === 'asc' ? <ChevronUp size={12} className="text-brand-yellow" /> : <ChevronDown size={12} className="text-brand-yellow" />
                      ) : (
                        <ChevronsUpDown size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                      )}
                    </div>

                    <div ref={popoverTribNacRef} className="relative ml-1">
                      <button 
                        onClick={() => setPopoverTribNacAberto(!popoverTribNacAberto)}
                        className={`p-1 rounded transition-colors ${filtroTribNac !== null ? 'bg-blue-50 text-brand-yellow' : 'text-gray-300 hover:text-gray-500 hover:bg-gray-100'}`}
                      >
                        <Filter size={12} className={filtroTribNac !== null ? 'fill-brand-yellow/20' : ''} />
                      </button>

                      {popoverTribNacAberto && (
                        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 bg-white border border-gray-100 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.1)] rounded-xl p-3 z-50 w-48 text-left normal-case tracking-normal">
                          <div className="max-h-48 overflow-y-auto custom-scrollbar flex flex-col gap-1.5 mb-3 pr-1">
                            
                            <label className="flex items-center gap-2 cursor-pointer text-[11px] font-black text-brand-dark hover:bg-gray-100 p-1.5 rounded transition-colors border-b border-gray-100 pb-2 mb-1">
                              <input
                                type="checkbox"
                                checked={filtroTribNac === null || filtroTribNac.length === valoresTribNacUnicos.length}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setFiltroTribNac(null);
                                  } else {
                                    setFiltroTribNac([]);
                                  }
                                }}
                                className="rounded border-gray-300 w-3.5 h-3.5"
                                style={{ accentColor: '#fdb913' }}
                              />
                              (Selecionar Tudo)
                            </label>

                            {valoresTribNacUnicos.map(val => {
                              const isChecked = filtroTribNac === null || filtroTribNac.includes(val);
                              return (
                                <label key={`trib-${val}`} className="flex items-center gap-2 cursor-pointer text-[11px] font-medium text-brand-dark hover:bg-gray-50 p-1.5 rounded transition-colors">
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setFiltroTribNac([...(filtroTribNac || []), val]);
                                      } else {
                                        const curr = filtroTribNac === null ? valoresTribNacUnicos : filtroTribNac;
                                        setFiltroTribNac(curr.filter(v => v !== val));
                                      }
                                    }}
                                    className="rounded border-gray-300 w-3.5 h-3.5"
                                    style={{ accentColor: '#fdb913' }}
                                  />
                                  {val}
                                </label>
                              );
                            })}
                            {valoresTribNacUnicos.length === 0 && (
                              <span className="text-xs text-gray-500 italic p-1">Sem valores.</span>
                            )}
                          </div>
                          
                          <div className="flex items-center justify-between border-t border-gray-50 pt-3">
                            <button
                              onClick={() => {
                                setFiltroTribNac(null);
                                setPopoverTribNacAberto(false);
                              }}
                              className="text-[9px] font-black text-gray-500 hover:text-red-500 uppercase transition-colors px-2"
                            >
                              Limpar
                            </button>
                            <button
                              onClick={() => setPopoverTribNacAberto(false)}
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

                {/* --- CABEÇALHO CUSTOMIZADO DO STATUS APURAÇÃO (RESTAURADO) --- */}
                <th className="p-4 relative">
                  <div className="flex items-center gap-1.5 justify-center text-[10px] font-black uppercase text-gray-500 tracking-widest select-none group">
                    <span className="cursor-pointer hover:text-gray-600 transition-colors" onClick={() => handleSort('apuracao')}>
                      Apurado
                    </span>
                    
                    <div className="flex flex-col text-gray-300 cursor-pointer" onClick={() => handleSort('apuracao')}>
                      {sortConfig?.key === 'apuracao' ? (
                        sortConfig.direction === 'asc' ? <ChevronUp size={12} className="text-brand-yellow" /> : <ChevronDown size={12} className="text-brand-yellow" />
                      ) : (
                        <ChevronsUpDown size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                      )}
                    </div>

                    <div ref={popoverStatusRef} className="relative ml-1">
                      <button 
                        onClick={() => setPopoverStatusAberto(!popoverStatusAberto)}
                        className={`p-1 rounded transition-colors ${filtroStatus !== null ? 'bg-blue-50 text-brand-yellow' : 'text-gray-300 hover:text-gray-500 hover:bg-gray-100'}`}
                      >
                        <Filter size={12} className={filtroStatus !== null ? 'fill-brand-yellow/20' : ''} />
                      </button>

                      {popoverStatusAberto && (
                        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 bg-white border border-gray-100 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.1)] rounded-xl p-3 z-50 w-48 text-left normal-case tracking-normal">
                          <div className="max-h-48 overflow-y-auto custom-scrollbar flex flex-col gap-1.5 mb-3 pr-1">
                            
                            <label className="flex items-center gap-2 cursor-pointer text-[11px] font-black text-brand-dark hover:bg-gray-100 p-1.5 rounded transition-colors border-b border-gray-100 pb-2 mb-1">
                              <input
                                type="checkbox"
                                checked={filtroStatus === null || filtroStatus.length === valoresStatusUnicos.length}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setFiltroStatus(null);
                                  } else {
                                    setFiltroStatus([]);
                                  }
                                }}
                                className="rounded border-gray-300 w-3.5 h-3.5"
                                style={{ accentColor: '#fdb913' }}
                              />
                              (Selecionar Tudo)
                            </label>

                            {valoresStatusUnicos.map(val => {
                              const isChecked = filtroStatus === null || filtroStatus.includes(val);
                              return (
                                <label key={`status-${val}`} className="flex items-center gap-2 cursor-pointer text-[11px] font-medium text-brand-dark hover:bg-gray-50 p-1.5 rounded transition-colors">
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setFiltroStatus([...(filtroStatus || []), val]);
                                      } else {
                                        const curr = filtroStatus === null ? valoresStatusUnicos : filtroStatus;
                                        setFiltroStatus(curr.filter(v => v !== val));
                                      }
                                    }}
                                    className="rounded border-gray-300 w-3.5 h-3.5"
                                    style={{ accentColor: '#fdb913' }}
                                  />
                                  {val === 'Sim' ? 'Apurado' : 'Não apurado'}
                                </label>
                              );
                            })}
                          </div>
                          
                          <div className="flex items-center justify-between border-t border-gray-50 pt-3">
                            <button
                              onClick={() => {
                                setFiltroStatus(null);
                                setPopoverStatusAberto(false);
                              }}
                              className="text-[9px] font-black text-gray-500 hover:text-red-500 uppercase transition-colors px-2"
                            >
                              Limpar
                            </button>
                            <button
                              onClick={() => setPopoverStatusAberto(false)}
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

                {/* --- CABEÇALHO CUSTOMIZADO DA CONFERÊNCIA --- */}
                <th className="p-4 relative">
                  <div className="flex items-center gap-1.5 justify-center text-[10px] font-black uppercase text-gray-500 tracking-widest select-none group">
                    <span>Conferência</span>
                    
                    <div ref={popoverConferenciaRef} className="relative ml-1">
                      <button 
                        onClick={() => setPopoverConferenciaAberto(!popoverConferenciaAberto)}
                        className={`p-1 rounded transition-colors ${filtroConferencia !== null ? 'bg-blue-50 text-brand-yellow' : 'text-gray-300 hover:text-gray-500 hover:bg-gray-100'}`}
                      >
                        <Filter size={12} className={filtroConferencia !== null ? 'fill-brand-yellow/20' : ''} />
                      </button>

                      {popoverConferenciaAberto && (
                        <div className="absolute top-full right-0 mt-2 bg-white border border-gray-100 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.1)] rounded-xl p-3 z-50 w-48 text-left normal-case tracking-normal">
                          <div className="max-h-48 overflow-y-auto custom-scrollbar flex flex-col gap-1.5 mb-3 pr-1">
                            
                            <label className="flex items-center gap-2 cursor-pointer text-[11px] font-black text-brand-dark hover:bg-gray-100 p-1.5 rounded transition-colors border-b border-gray-100 pb-2 mb-1">
                              <input
                                type="checkbox"
                                checked={filtroConferencia === null || filtroConferencia.length === valoresConferenciaUnicos.length}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setFiltroConferencia(null);
                                  } else {
                                    setFiltroConferencia([]);
                                  }
                                }}
                                className="rounded border-gray-300 w-3.5 h-3.5"
                                style={{ accentColor: '#fdb913' }}
                              />
                              (Selecionar Tudo)
                            </label>

                            {valoresConferenciaUnicos.map(val => {
                              const isChecked = filtroConferencia === null || filtroConferencia.includes(val);
                              const labelText = val === 'vistos' ? 'Conferidos' : 'Pendentes';
                              return (
                                <label key={`conf-${val}`} className="flex items-center gap-2 cursor-pointer text-[11px] font-medium text-brand-dark hover:bg-gray-50 p-1.5 rounded transition-colors">
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setFiltroConferencia([...(filtroConferencia || []), val]);
                                      } else {
                                        const curr = filtroConferencia === null ? valoresConferenciaUnicos : filtroConferencia;
                                        setFiltroConferencia(curr.filter(v => v !== val));
                                      }
                                    }}
                                    className="rounded border-gray-300 w-3.5 h-3.5"
                                    style={{ accentColor: '#fdb913' }}
                                  />
                                  {labelText}
                                </label>
                              );
                            })}
                          </div>
                          
                          <div className="flex items-center justify-between border-t border-gray-50 pt-3">
                            <button
                              onClick={() => {
                                setFiltroConferencia(null);
                                setPopoverConferenciaAberto(false);
                              }}
                              className="text-[9px] font-black text-gray-500 hover:text-red-500 uppercase transition-colors px-2"
                            >
                              Limpar
                            </button>
                            <button
                              onClick={() => setPopoverConferenciaAberto(false)}
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
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                <tr>
                  <td colSpan={6} className="p-16 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <Loader2 size={30} className="animate-spin text-brand-yellow" />
                      <span className="text-gray-300 font-bold italic">Sincronizando dados com o Domínio...</span>
                    </div>
                  </td>
                </tr>
              ) : paginadas.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-16 text-center text-gray-500 font-bold">
                    Nenhum registro encontrado para os filtros selecionados.
                  </td>
                </tr>
              ) : paginadas.map((f, index) => {
                const isFirstRows = index < 3;
                const infoValidacao = validados[f.cod];
                const isValidado = !!infoValidacao;

                return (
                  <tr key={f.cod} className={`hover:bg-gray-50/50 transition-colors group ${selectedCodigos.includes(f.cod) ? 'bg-yellow-50/30' : ''}`}>
                    <td className="p-3 align-middle text-center border-r border-gray-50">
                      <input type="checkbox" checked={selectedCodigos.includes(f.cod)} onChange={() => handleSelectRow(f.cod)} style={{ accentColor: '#fdb913' }} className="w-4 h-4 rounded border-gray-300 cursor-pointer" />
                    </td>
                    <td className="p-4 align-top border-r border-gray-50 min-w-75">
                    <div className="flex flex-col gap-1">
                      <div className="font-bold text-brand-dark flex items-center gap-1.5">
                        <span className="text-brand-yellow mr-2 text-[11px] font-black">{f.cod}</span>
                        <span>{f.empresa}</span>
                        
                        {(f.cert_status === 'Vencido' || f.cert_status === 'Sem certificado' || f.cert_status === 'Não Vinculado') && (
                          <span 
                            title={`ALERTA: Certificado ${f.cert_status}${f.cert_validade !== '-' ? ` em ${f.cert_validade}` : ''}`}
                            className="flex items-center"
                          >
                            <AlertTriangle 
                              size={14} 
                              className="text-red-500 fill-red-50 animate-pulse shrink-0 cursor-help" 
                            />
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-[12px] font-mono text-gray-500 font-bold tracking-tight">{f.cnpj}</span>
                        <span className="px-2 py-0.5 rounded-md text-[9px] font-black uppercase bg-blue-50 text-blue-600 border border-blue-100">
                          {f.regime}
                        </span>
                      </div>
                    </div>
                    </td>

                    <td className="p-4 align-top">
                      <div className="flex flex-col">
                        <span className="font-bold text-sm text-brand-dark">{formatBRL(f.total)}</span>
                        <span className="text-[9px] text-gray-500 font-medium mt-1 uppercase">Atualizado: {f.ultima}</span>
                      </div>
                    </td>

                    <td className="p-4 align-top">
                      <div className="flex flex-col">
                        <span className="font-bold text-sm text-brand-dark">{formatBRL(f.dominio)}</span>
                        <span className={`text-[10px] font-black mt-1 ${Math.abs(f.diferenca) < 0.01 ? 'text-green-500' : 'text-red-500'}`}>
                          DIF: {formatBRL(f.diferenca)}
                        </span>
                      </div>
                    </td>

                    <td className="p-4 align-middle text-center">
                      {f.cTribNac && f.cTribNac.length > 0 ? (
                        f.cTribNac.length === 1 ? (
                          <span className="px-2.5 py-1.5 rounded-md text-[10px] font-black border bg-gray-50 text-gray-600 border-gray-200 inline-block">
                            {f.cTribNac[0]}
                          </span>
                        ) : (
                          <div className="group/trib relative inline-block">
                            <span className="px-2.5 py-1.5 rounded-md text-[10px] font-black border bg-blue-50 text-blue-600 border-blue-200 cursor-help flex items-center gap-1">
                              {f.cTribNac[0]} 
                              <span className="text-[8px] bg-blue-100 text-blue-700 px-1 py-0.5 rounded leading-none">
                                +{f.cTribNac.length - 1}
                              </span>
                            </span>
                            
                            <div className={`absolute ${isFirstRows ? 'top-full mt-2' : 'bottom-full mb-2'} left-1/2 -translate-x-1/2 w-max max-w-50 bg-brand-dark text-white text-[10px] font-medium p-3 rounded-xl opacity-0 group-hover/trib:opacity-100 transition-opacity pointer-events-none z-50 text-center shadow-xl`}>
                              <strong className="text-brand-yellow block mb-2 text-xs">Códigos de Tributação</strong>
                              <div className="flex flex-wrap gap-1.5 justify-center">
                                {f.cTribNac.map(cod => (
                                  <span key={cod} className="bg-white/10 px-1.5 py-0.5 rounded border border-white/20">
                                    {cod}
                                  </span>
                                ))}
                              </div>
                              <div className={`absolute ${isFirstRows ? 'bottom-full -mb-px border-b-brand-dark' : 'top-full -mt-1 border-t-brand-dark'} left-1/2 -translate-x-1/2 border-4 border-transparent`}></div>
                            </div>
                          </div>
                        )
                      ) : (
                        <span className="text-gray-300 font-bold inline-block">—</span>
                      )}
                    </td>

                    <td className="p-4 align-middle text-center border-r border-gray-50">
                      <span className={`px-4 py-2 rounded-xl text-[11px] font-black uppercase border transition-all shadow-sm ${
                        f.apuracao === 'Sim'
                          ? 'bg-green-50 text-green-700 border-green-200 shadow-green-100/50'
                          : 'bg-red-50 text-red-700 border-red-200 shadow-red-100/50'
                      } `}>
                        {f.apuracao === 'Sim' ? 'Apurado' : 'Não apurado'}
                      </span>
                    </td>
                   
                    <td className="p-4 align-middle text-center">
                      <div className="flex flex-col items-center justify-center gap-1 min-w-12.5">
                        <button 
                          onClick={() => toggleValidado(f.cod)}
                          title={isValidado ? "Desfazer conferência" : "Marcar como conferido"}
                          className={`p-1.5 rounded-lg transition-all ${
                            isValidado 
                              ? 'bg-green-50 text-green-500 hover:bg-green-100 hover:text-green-600 border border-green-200' 
                              : 'bg-gray-50 text-gray-300 hover:bg-gray-100 hover:text-gray-500 border border-gray-200'
                          }`}
                        >
                          <CheckCircle2 size={20} className={isValidado ? 'fill-green-100' : ''} />
                        </button>
                        
                        {isValidado && (
                          <div className="flex flex-col items-center leading-[1.1] mt-0.5">
                            <span className="text-[9px] font-black text-gray-500 uppercase truncate max-w-17.5" title={infoValidacao.user}>
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
                );
              })}
            </tbody>
          </table>
        </div>

        {/* PAGINAÇÃO */}
        {!loading && faturasFiltradas.length > 0 && (
          <div className="bg-gray-50/30 border-t border-gray-100 p-5 flex items-center justify-between text-[10px] font-black text-gray-500 uppercase tracking-widest">
            <div>
              Mostrando <span className="text-brand-dark">{indexInicio + 1} - {Math.min(indexInicio + itensPorPagina, faturasFiltradas.length)}</span> de {faturasFiltradas.length}
            </div>
            <div className="flex items-center gap-4">
              <button onClick={() => setPaginaAtual(prev => Math.max(prev - 1, 1))} disabled={paginaAtual === 1} className="p-2 rounded-xl hover:bg-white hover:shadow-sm disabled:opacity-20 transition-all text-brand-dark border border-transparent hover:border-gray-200">
                <ChevronLeft size={18} />
              </button>
              <span className="text-brand-dark bg-white px-4 py-1.5 rounded-xl border border-gray-200 shadow-sm font-black">
                {paginaAtual} / {totalPaginas}
              </span>
              <button onClick={() => setPaginaAtual(prev => Math.min(prev + 1, totalPaginas))} disabled={paginaAtual === totalPaginas} className="p-2 rounded-xl hover:bg-white hover:shadow-sm disabled:opacity-20 transition-all text-brand-dark border border-transparent hover:border-gray-200">
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* MODAL DE AVISO */}
      {confirmModal.isOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-60 p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-[25px] shadow-2xl w-full max-w-sm overflow-hidden flex flex-col border border-gray-100 animate-in zoom-in-95 duration-200">
            <div className="bg-brand-dark px-6 py-4 flex items-center justify-between border-b-4 border-brand-yellow">
              <div className="flex items-center gap-2 text-white">
                <CheckCircle2 size={20} className="text-brand-yellow" />
                <h2 className="font-bold text-lg tracking-tight">Aviso do Sistema</h2>
              </div>
              <button onClick={() => setConfirmModal({ isOpen: false, message: '' })} className="text-gray-500 hover:text-white transition-colors"><X size={22} /></button>
            </div>
            <div className="p-8 space-y-6 text-center flex flex-col items-center">
              <div className="w-16 h-16 bg-brand-yellow/10 rounded-full flex items-center justify-center text-brand-yellow mb-2"><CheckCircle2 size={32} /></div>
              <p className="text-brand-dark text-sm font-bold leading-relaxed">{confirmModal.message}</p>
              <button onClick={() => setConfirmModal({ isOpen: false, message: '' })} className="w-full px-4 py-3 bg-brand-dark text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:text-brand-yellow transition-all shadow-md">Entendi</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 5px; height: 5px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: #f9fafb; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #e5e7eb; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #d1d5db; }
      `}</style>
    </div>
  );
};