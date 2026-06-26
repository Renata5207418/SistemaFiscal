import React, { useEffect, useState, useCallback, useRef } from 'react';
import api from '../services/api';
import { 
  RefreshCw, Download, ChevronLeft, 
  ChevronRight, Search, Calendar, Loader2, CheckCircle2, Filter, AlertTriangle, X, DollarSign,
  ChevronUp, ChevronDown, ChevronsUpDown, RotateCcw, ListTodo, CheckCheck, PlayCircle, ShieldCheck, 
  MoreVertical, Info, BookOpen,
} from 'lucide-react';
import * as XLSX from 'xlsx';

// --- IMPORTAÇÕES PARA DATA EM PORTUGUÊS ---
import DatePicker, { registerLocale } from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { ptBR } from "date-fns/locale"; 

registerLocale("pt-BR", ptBR);
// ------------------------------------------

interface Fatura {
  cod: number;
  grupo: string;
  cnpj: string;
  empresa: string;
  ultima: string;
  total: number;
  dominio: number;
  diferenca: number;
  apuracao: string;
  declarado: number | null; 
  dif_declaracao: number | string;
  imposto_dominio: number;
  erro_texto: string | null;
  data_declaracao?: string | null;
  ultima_raw?: string;
  data_declaracao_raw?: string | null;
  guia_enviada: string;
  pgdas_hash?: string;
  das_hash?: string;
  pgdas_onvio?: boolean;
  das_onvio?: boolean;
  conferencia?: { status: boolean; user: string; date: string };
  cert_status?: string;   
  cert_validade?: string;
  fator_r_percentual?: number | null;
  cTribNac?: string[];
}

type SortConfig = { key: keyof Fatura | string; direction: 'asc' | 'desc'; } | null;

export const SimplesNacional: React.FC = () => {
  const [faturas, setFaturas] = useState<Fatura[]>([]);
  const [busca, setBusca] = useState('');
  const [sortConfig, setSortConfig] = useState<SortConfig>(null); 
  const [loading, setLoading] = useState(false);
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  
  const [selectedCodigos, setSelectedCodigos] = useState<number[]>([]);
  const [alertDiferencas, setAlertDiferencas] = useState<Fatura[] | null>(null);
  const [pendingSubmit, setPendingSubmit] = useState<{ faturas: Fatura[], tipoDeclaracao: number } | null>(null);
  const [confirmModal, setConfirmModal] = useState<{ isOpen: boolean; message: string }>({ isOpen: false, message: '' });

  const [validados, setValidados] = useState<Record<number, { date: string, user: string }>>({});

  const [filtroValoresTotal, setFiltroValoresTotal] = useState<number[] | null>(null);
  const [popoverTotalAberto, setPopoverTotalAberto] = useState(false);
  const popoverTotalRef = useRef<HTMLDivElement>(null);

  const [filtroValoresDominio, setFiltroValoresDominio] = useState<number[] | null>(null);
  const [popoverDominioAberto, setPopoverDominioAberto] = useState(false);
  const popoverDominioRef = useRef<HTMLDivElement>(null);

  const [filtroApuracao, setFiltroApuracao] = useState<string[] | null>(null);
  const [popoverApuracaoAberto, setPopoverApuracaoAberto] = useState(false);
  const popoverApuracaoRef = useRef<HTMLDivElement>(null);

  const [filtroFatorR, setFiltroFatorR] = useState<string[] | null>(null);
  const [popoverFatorRAberto, setPopoverFatorRAberto] = useState(false);
  const popoverFatorRRef = useRef<HTMLDivElement>(null);

  const [filtroSerpro, setFiltroSerpro] = useState<string[] | null>(null);
  const [popoverSerproAberto, setPopoverSerproAberto] = useState(false);
  const popoverSerproRef = useRef<HTMLDivElement>(null);

  const [filtroOnvio, setFiltroOnvio] = useState<string[] | null>(null);
  const [popoverOnvioAberto, setPopoverOnvioAberto] = useState(false);
  const popoverOnvioRef = useRef<HTMLDivElement>(null);

  const [filtroConferencia, setFiltroConferencia] = useState<string[] | null>(null);
  const [popoverConferenciaAberto, setPopoverConferenciaAberto] = useState(false);
  const popoverConferenciaRef = useRef<HTMLDivElement>(null);

  const [filtroTribNac, setFiltroTribNac] = useState<string[] | null>(null);
  const [popoverTribNacAberto, setPopoverTribNacAberto] = useState(false);
  const popoverTribNacRef = useRef<HTMLDivElement>(null);
  
  const tableScrollRef = useRef<HTMLDivElement>(null);
  // --------------------------------------------------------------

  const [isAcompanhamentoOpen, setIsAcompanhamentoOpen] = useState(false);
  const [abaAcompanhamento, setAbaAcompanhamento] = useState<'processando' | 'concluidas'>('processando');
  const [tarefasFila, setTarefasFila] = useState<any[]>([]);
  const [isHelpModalOpen, setIsHelpModalOpen] = useState(false);

  const [dropdownOpen, setDropdownOpen] = useState<number | null>(null);
  const dropdownRef = useRef<HTMLTableSectionElement>(null);
  const [isDownloadMenuOpen, setIsDownloadMenuOpen] = useState(false);
  const downloadDropdownRef = useRef<HTMLDivElement>(null);

  const [mesano, setMesano] = useState(() => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  const [paginaAtual, setPaginaAtual] = useState(1);
  const itensPorPagina = 10;
  const [filtroDifFaturamento, setFiltroDifFaturamento] = useState(false);
  const [filtroDifDeclaracao, setFiltroDifDeclaracao] = useState(false);

  // Fecha todos os modais ao clicar fora
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) setDropdownOpen(null);
      if (downloadDropdownRef.current && !downloadDropdownRef.current.contains(event.target as Node)) setIsDownloadMenuOpen(false);
      if (popoverTotalRef.current && !popoverTotalRef.current.contains(event.target as Node)) setPopoverTotalAberto(false);
      if (popoverDominioRef.current && !popoverDominioRef.current.contains(event.target as Node)) setPopoverDominioAberto(false);
      if (popoverApuracaoRef.current && !popoverApuracaoRef.current.contains(event.target as Node)) setPopoverApuracaoAberto(false);
      if (popoverFatorRRef.current && !popoverFatorRRef.current.contains(event.target as Node)) setPopoverFatorRAberto(false);
      if (popoverSerproRef.current && !popoverSerproRef.current.contains(event.target as Node)) setPopoverSerproAberto(false);
      if (popoverOnvioRef.current && !popoverOnvioRef.current.contains(event.target as Node)) setPopoverOnvioAberto(false);
      if (popoverConferenciaRef.current && !popoverConferenciaRef.current.contains(event.target as Node)) setPopoverConferenciaAberto(false);
      if (popoverTribNacRef.current && !popoverTribNacRef.current.contains(event.target as Node)) setPopoverTribNacAberto(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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

  const formatBRL = (v: any) => (typeof v === 'number' ? v : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const formatCNPJ = (cnpjRaw: any) => {
    if (!cnpjRaw) return '—';
    const num = String(cnpjRaw).replace(/\D/g, '');
    return num.length === 14 ? num.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5") : String(cnpjRaw);
  };
  const formatPercentDisplay = (v: any) => {
    if (typeof v !== 'number') return '-';
    const valorReal = v / 100;
    return valorReal.toLocaleString('pt-BR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 1
    }) + '%';
  };
  const formatData = (isoDate: string) => {
    if (!isoDate) return '—';
    let safeDate = isoDate;
    if (typeof isoDate === 'string' && !isoDate.endsWith('Z') && !isoDate.includes('+')) safeDate += 'Z';
    const d = new Date(safeDate);
    return isNaN(d.getTime()) ? isoDate : `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  };

  const checkIsFilial = (cnpjRaw: string) => {
    if (!cnpjRaw || cnpjRaw === '—') return false;
    const num = String(cnpjRaw).replace(/\D/g, '');
    return num.length === 14 && num.substring(8, 12) !== '0001';
  };

  const fetchData = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const mesFormatado = mesano.replace('-', '');
      const { data } = await api.get(`/automacao/painel-geral-sn?mesano=${mesFormatado}`);
      
      if (data.faturas) {
        const faturasFormatadas = data.faturas.map((f: any) => ({
            ...f,
            cnpj: formatCNPJ(f.cnpj),
            ultima_raw: f.ultima,
            data_declaracao_raw: f.data_declaracao,
            ultima: formatData(f.ultima),
            data_declaracao: f.data_declaracao ? formatData(f.data_declaracao) : null
        }));
        setFaturas(faturasFormatadas);
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
      console.error("Erro ao carregar painel consolidado:", err);
      setFaturas([]); 
      setValidados({});
    } finally {
      setLoading(false);
    }
  }, [mesano]);

  const fetchFilaReal = useCallback(async () => {
    try {
      const { data } = await api.get('/automacao/v2/fila/tarefas?limit=100');
      if(data.success) setTarefasFila(data.data);
    } catch (err) {}
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    fetchFilaReal();
    const interval = setInterval(fetchFilaReal, 3000);
    return () => clearInterval(interval);
  }, [fetchFilaReal]);

  const handleSort = (key: keyof Fatura | string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') direction = 'desc';
    setSortConfig({ key, direction });
  };

  const shiftMonth = (delta: number) => {
    if (!mesano) return;
    const [y, m] = mesano.split('-').map(Number);
    const newDate = new Date(y, m - 1 + delta, 1);
    setMesano(`${newDate.getFullYear()}-${String(newDate.getMonth() + 1).padStart(2, "0")}`);
  };

  const executeSolicitacao = async (listaFaturas: Fatura[], tipoDeclaracao: number = 1) => {
    setAlertDiferencas(null); 
    setPendingSubmit(null); 
    setIsBatchProcessing(true);
    setDropdownOpen(null);
    
    const cnpjsParaEnviar = listaFaturas.map(f => f.cnpj.replace(/\D/g, ''));

    try {
      await api.post('/automacao/declaracao', { 
        pa: parseInt(mesano.replace('-', '')), 
        cnpjs: cnpjsParaEnviar, 
        tipoDeclaracao: tipoDeclaracao 
      });
    } catch (err) {
      console.error("Erro ao transmitir lote", err);
    }
    
    setIsBatchProcessing(false); 
    setSelectedCodigos([]); 
    setIsAcompanhamentoOpen(true); 
    setAbaAcompanhamento('processando');
    fetchFilaReal();
  };

  const handleRecalcularXML = (codigos: number[]) => {
    if (codigos.length === 0) return;
    
    setConfirmModal({ 
      isOpen: true, 
      message: `Enfileirando a atualização de faturamento XML para ${codigos.length} empresa(s).\nO recálculo na AWS S3 iniciará em segundo plano.` 
    });
    setDropdownOpen(null);

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

  const handleSolicitarPGDAS = (fatura: Fatura, tipo: number) => {
    setDropdownOpen(null);
    if (!fatura.cnpj || fatura.cnpj === '—') return setConfirmModal({ isOpen: true, message: "CNPJ não encontrado." });
    
    // BLOQUEIO PARA FILIAL
    if (checkIsFilial(fatura.cnpj)) {
       return setConfirmModal({ isOpen: true, message: `A empresa ${fatura.cod} é uma FILIAL. A apuração e transmissão do Simples Nacional ocorrem unicamente na Matriz.` });
    }

    if (fatura.apuracao !== 'Sim') {
      return setConfirmModal({ 
          isOpen: true, 
          message: `A empresa ${fatura.cod} - ${fatura.empresa} não está apurada no Domínio. Conclua a apuração antes de transmitir.` 
      });
    }

    if (Math.abs(fatura.diferenca) >= 0.01) { 
      setAlertDiferencas([fatura]); 
      setPendingSubmit({ faturas: [fatura], tipoDeclaracao: tipo }); 
    } else {
      executeSolicitacao([fatura], tipo);
    }
  };

  const handleSolicitarLote = () => {
    const selecionadas = faturas.filter(f => selectedCodigos.includes(f.cod));
    
    // IGNORA FILIAIS AUTOMATICAMENTE NO LOTE
    const matrizes = selecionadas.filter(f => !checkIsFilial(f.cnpj));
    const validas = matrizes.filter(f => f.cnpj && f.cnpj !== '—');
    
    if (validas.length === 0) {
      if (selecionadas.length > 0) return setConfirmModal({ isOpen: true, message: "Apenas filiais foram selecionadas. Filiais não geram declaração no Simples Nacional." });
      return setConfirmModal({ isOpen: true, message: "Nenhuma empresa válida selecionada." });
    }
    
    const naoApuradas = validas.filter(f => f.apuracao !== 'Sim');
    if (naoApuradas.length > 0) {
        const nomes = naoApuradas.slice(0, 3).map(f => f.cod).join(', ');
        const reticencias = naoApuradas.length > 3 ? '...' : '';
        return setConfirmModal({ 
            isOpen: true, 
            message: `Existem ${naoApuradas.length} matrizes não apuradas no Domínio na sua seleção (Ex: ${nomes}${reticencias}). Remova-as da seleção para continuar.` 
        });
    }

    const comDiferenca = validas.filter(f => Math.abs(f.diferenca) >= 0.01);
    if (comDiferenca.length > 0) { 
      setAlertDiferencas(comDiferenca); 
      setPendingSubmit({ faturas: validas, tipoDeclaracao: 1 }); 
    } else {
      executeSolicitacao(validas, 1);
    }
  };

  const handleDownloadGuia = async (cod: number, tipo: 'pgdas' | 'das') => {
    setDropdownOpen(null);
    try {
      const response = await api.get(`/automacao/download-guia?cod_cliente=${cod}&mesano=${mesano.replace('-','')}&tipo=${tipo}`, { responseType: 'blob' });
      const fatura = faturas.find(f => f.cod === cod);
      const hash = tipo === 'pgdas' ? fatura?.pgdas_hash : fatura?.das_hash;
      const hashStr = hash ? `-${hash}` : '';
      const mesAnoFormatado = `${mesano.split('-')[1]}${mesano.split('-')[0]}`;
      const filename = `${cod}-${tipo.toUpperCase()}-${mesAnoFormatado}${hashStr}.pdf`;

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err: any) {
      setConfirmModal({ isOpen: true, message: err.response?.data?.detail || `Aviso: O ${tipo.toUpperCase()} não foi localizado no banco (pode não haver imposto devido).` });
    }
  };

  const handleDownloadLote = async (tipo: 'ambos' | 'pgdas' | 'das') => {
    setIsDownloadMenuOpen(false);
    const selecionadas = faturas.filter(f => selectedCodigos.includes(f.cod));
    
    if (selecionadas.length === 0) return setConfirmModal({ isOpen: true, message: "Nenhuma empresa selecionada." });
    
    setConfirmModal({ isOpen: true, message: `Gerando arquivo ZIP com as guias (${tipo.toUpperCase()}). Aguarde...` });
    
    try {
      const response = await api.post('/automacao/download-lote-zip', {
          codigos: selecionadas.map(f => f.cod),
          mesano: mesano.replace('-', ''),
          tipo_download: tipo
      }, { responseType: 'blob' });
      
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      const mesAnoFormatado = `${mesano.split('-')[1]}${mesano.split('-')[0]}`;
      link.setAttribute('download', `Lote_Guias_${tipo.toUpperCase()}_${mesAnoFormatado}.zip`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      
      setConfirmModal({ isOpen: false, message: '' }); 
    } catch (err: any) {
      setConfirmModal({ isOpen: true, message: "Erro ao gerar arquivo ZIP." });
    }
  };

  const handleDarVisto = async (taskId: string) => {
    try {
      await api.delete(`/automacao/v2/fila/tarefas/${taskId}`);
      fetchFilaReal(); 
      fetchData(false); 
    } catch (err) {}
  };

  const handleDarVistoTodos = async () => {
    for (const t of concluidasFila) {
      await api.delete(`/automacao/v2/fila/tarefas/${t.id}`);
    }
    fetchFilaReal();
    fetchData(false);
  };

  const handleFecharModal = () => {
    setIsAcompanhamentoOpen(false);
    fetchData(false);
  };

  const limparTodosOsFiltros = () => {
    setBusca(''); setFiltroDifFaturamento(false); setFiltroDifDeclaracao(false);
    setSortConfig(null); setPaginaAtual(1); setSelectedCodigos([]);
    setFiltroValoresTotal(null); setFiltroValoresDominio(null);
    setFiltroApuracao(null); setFiltroSerpro(null); setFiltroOnvio(null); setFiltroConferencia(null); setFiltroFatorR(null); setFiltroTribNac(null);
  };

  const handleScrollTable = (direction: 'left' | 'right') => {
    if (tableScrollRef.current) {
      const scrollAmount = 400; // Quantidade de rolagem por clique
      tableScrollRef.current.scrollBy({ 
        left: direction === 'left' ? -scrollAmount : scrollAmount, 
        behavior: 'smooth' 
      });
    }
  };

  // Funções Auxiliares para Status
  const getSerproTags = (f: Fatura) => {
      // Se for filial, não recebe nenhuma tag de status do Serpro
      if (checkIsFilial(f.cnpj)) return ['nao_aplicavel']; 

      const tags: string[] = [];
      if (f.erro_texto) {
          tags.push('erro');
      } else if (f.declarado !== null && f.declarado !== undefined) {
          tags.push('transmitidas');
          
          // Se tiver qualquer diferença matemática (maior ou igual a 1 centavo), aplica o filtro
          if (Math.abs(Number(f.dif_declaracao)) >= 0.01) {
              tags.push('com_diferenca');
          }
      } else {
          tags.push('nao_transmitidas');
      }
      return tags;
  };

  const getOnvioTags = (f: Fatura) => {
      const tags: string[] = [];
      if (f.pgdas_onvio) tags.push('publicadas');
      if (f.declarado !== null && f.declarado !== undefined && !f.pgdas_onvio) tags.push('pendentes');
      if (f.declarado === 0) tags.push('isento');
      
      if (tags.length === 0) tags.push('nao_aplicavel');
      return tags;
  };

  const getFatorRStatus = (f: Fatura) => {
    if (typeof f.fator_r_percentual !== 'number') return 'sem_fator';
    if (f.fator_r_percentual < 2800) return 'risco';
    if (f.fator_r_percentual <= 3000) return 'atencao';
    return 'seguro';
  };

  // --- FILTRAGEM MASTER ---
  let faturasFiltradas = faturas.filter(f => {
    const mBusca = (f.empresa || '').toLowerCase().includes(busca.toLowerCase()) || (f.cod || '').toString().includes(busca) || (f.cnpj || '').includes(busca);
    const mDifFat = !filtroDifFaturamento || Math.abs(f.diferenca) >= 0.01;
    const mDifDec = !filtroDifDeclaracao || Math.abs(Number(f.dif_declaracao)) >= 0.01;

    const mTotal = filtroValoresTotal === null || filtroValoresTotal.includes(f.total);
    const mDominio = filtroValoresDominio === null || filtroValoresDominio.includes(f.dominio);
    const mApuracao = filtroApuracao === null || filtroApuracao.includes(f.apuracao);
    const mFatorR = filtroFatorR === null || filtroFatorR.includes(getFatorRStatus(f));
    
    const mSerpro = filtroSerpro === null || getSerproTags(f).some(tag => filtroSerpro.includes(tag));
    const mOnvio = filtroOnvio === null || getOnvioTags(f).some(tag => filtroOnvio.includes(tag));

    const statusConf = !!validados[f.cod] ? 'conferidos' : 'pendentes';
    const mConf = filtroConferencia === null || filtroConferencia.includes(statusConf);

    const mTribNac = filtroTribNac === null || 
      (Array.isArray(f.cTribNac) && f.cTribNac.length > 0 
        ? f.cTribNac.some(cod => filtroTribNac.includes(cod))
        : filtroTribNac.includes('-'));

    // Adicionado o && mTribNac no final da linha abaixo:
    return mBusca && mDifFat && mDifDec && mTotal && mDominio && mApuracao && mSerpro && mOnvio && mConf && mFatorR && mTribNac;
  });

  if (sortConfig !== null) {
    faturasFiltradas.sort((a: any, b: any) => {
      if (a[sortConfig.key] < b[sortConfig.key]) return sortConfig.direction === 'asc' ? -1 : 1;
      if (a[sortConfig.key] > b[sortConfig.key]) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }

  // --- DEFINIÇÃO DA VARIÁVEL DE VERIFICAÇÃO DE FILTROS ---
  const hasActiveFilters = busca !== '' || filtroDifFaturamento || filtroDifDeclaracao || 
        filtroValoresTotal !== null || filtroValoresDominio !== null || 
        filtroApuracao !== null || filtroSerpro !== null || 
        filtroOnvio !== null || filtroConferencia !== null || filtroFatorR !== null || filtroTribNac !== null || sortConfig !== null;
  // -------------------------------------------------------

  // Reseta página se mudar filtros
  useEffect(() => { setPaginaAtual(1); }, [busca, mesano, filtroDifFaturamento, filtroDifDeclaracao, filtroValoresTotal, filtroValoresDominio, filtroApuracao, filtroSerpro, filtroOnvio, filtroConferencia, filtroFatorR, filtroTribNac]);

  const totalPaginas = Math.max(1, Math.ceil(faturasFiltradas.length / itensPorPagina));
  const indexInicio = (paginaAtual - 1) * itensPorPagina;
  const faturasPaginadas = faturasFiltradas.slice(indexInicio, indexInicio + itensPorPagina);
  const isAllSelected = faturasFiltradas.length > 0 && selectedCodigos.length === faturasFiltradas.length;

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => { e.target.checked ? setSelectedCodigos(faturasFiltradas.map(f => f.cod)) : setSelectedCodigos([]); };
  const handleSelectRow = (cod: number) => setSelectedCodigos(prev => prev.includes(cod) ? prev.filter(c => c !== cod) : [...prev, cod]);

  const handleExportarExcel = () => {
    if (faturasFiltradas.length === 0) return alert("Nenhum dado para exportar.");
    const dadosExcel = faturasFiltradas.map(f => ({
      "CÓD": f.cod, "GRUPO": f.grupo, "CNPJ": f.cnpj, "EMPRESA": f.empresa, 
      "CÓD. TRIB.": f.cTribNac && f.cTribNac.length > 0 ? f.cTribNac.join(', ') : '-',
      "SITUAÇÃO": f.apuracao === 'Sim' ? 'Apurado' : '', "VALOR TOTAL": f.total, 
      "FATOR R": typeof f.fator_r_percentual === 'number' ? formatPercentDisplay(f.fator_r_percentual) : '-',
      "VALOR DOMÍNIO": f.dominio, "DIFERENÇA": f.diferenca, "ÚLTIMA ATUALIZAÇÃO": f.ultima,
      "DECLARADO PGDAS": f.erro_texto ? 'ERRO' : f.declarado ?? '-', "IMPOSTO DOMINIO": f.imposto_dominio,
      "DIF. DECLARAÇÃO": f.dif_declaracao, "ERRO PGDAS": f.erro_texto || '-', "ENVIO ONVIO": f.pgdas_onvio ? 'Sim' : 'Não',
      "CONFERIDO": validados[f.cod] ? 'Sim' : 'Não',
      "DATA CONFERÊNCIA": validados[f.cod] ? validados[f.cod].date : '-',
      "USUÁRIO CONFERÊNCIA": validados[f.cod] ? validados[f.cod].user : '-'
    }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(dadosExcel), "Faturamento");
    XLSX.writeFile(workbook, `faturamento_SN${mesano.replace('-', '')}.xlsx`);
  };

  // Valores únicos para popular os menus do Excel
  const valoresTotalUnicos = Array.from(new Set(faturas.map(f => f.total))).sort((a,b)=>a-b);
  const valoresDominioUnicos = Array.from(new Set(faturas.map(f => f.dominio))).sort((a,b)=>a-b);
  const valoresApuracaoUnicos = Array.from(new Set(faturas.map(f => f.apuracao))).sort();
  const valoresSerproUnicos = Array.from(new Set(faturas.flatMap(f => getSerproTags(f)))).filter(v => v !== 'nao_aplicavel').sort();
  const valoresOnvioUnicos = Array.from(new Set(faturas.flatMap(f => getOnvioTags(f)))).filter(v => v !== 'nao_aplicavel').sort();
  const valoresConferenciaUnicos = ['conferidos', 'pendentes'];
  const valoresFatorRUnicos = ['risco', 'atencao', 'seguro', 'sem_fator'];

  const valoresTribNacUnicos = Array.from(new Set(
    faturas.flatMap(f => (Array.isArray(f.cTribNac) && f.cTribNac.length > 0) ? f.cTribNac : ['-'])
  )).sort();

  // Função Auxiliar para renderizar a coluna simples (Sem filtro)
  const renderTh = (label: string, sortKey: keyof Fatura, align: 'left'|'center'|'right' = 'left') => {
    const isActiveSort = sortConfig !== null && sortConfig.key === sortKey;
    return (
      <th className={`p-3 align-middle relative select-none bg-brand-panel group`}>
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

  // Função Auxiliar para renderizar o cabeçalho estilo Excel (Com Filtro)
  const renderExcelTh = (
      label: string,
      sortKey: keyof Fatura | string, 
      filterValues: any[] | null,
      setFilterValues: React.Dispatch<React.SetStateAction<any[] | null>>,
      isPopoverOpen: boolean,
      setPopoverOpen: React.Dispatch<React.SetStateAction<boolean>>,
      popoverRef: any, // Tipo corrigido para evitar conflitos de typescript
      uniqueOptions: any[],
      formatLabel: (val: any) => string,
      align: 'left' | 'center' = 'left'
  ) => {
      const isActive = sortConfig?.key === sortKey;
      return (
        <th className="p-3 relative bg-brand-panel">
          <div className={`flex items-center gap-1.5 ${align === 'center' ? 'justify-center' : 'justify-start'} text-[10px] font-black uppercase text-gray-500 tracking-widest select-none group`}>
            <span className="cursor-pointer hover:text-gray-600 transition-colors" onClick={() => handleSort(sortKey)}>
              {label}
            </span>
            
            <div className="flex flex-col text-gray-300 cursor-pointer" onClick={() => handleSort(sortKey)}>
              {isActive ? (
                sortConfig.direction === 'asc' ? <ChevronUp size={12} className="text-brand-yellow" /> : <ChevronDown size={12} className="text-brand-yellow" />
              ) : (
                <ChevronsUpDown size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />
              )}
            </div>

            <div ref={popoverRef} className="relative ml-1">
              <button 
                onClick={() => setPopoverOpen(!isPopoverOpen)}
                className={`p-1 rounded transition-colors ${filterValues !== null ? 'bg-blue-50 text-brand-yellow' : 'text-gray-300 hover:text-gray-500 hover:bg-gray-100'}`}
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
                        onChange={(e) => {
                          if (e.target.checked) {
                            setFilterValues(null);
                          } else {
                            setFilterValues([]);
                          }
                        }}
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
                      onClick={() => {
                        setFilterValues(null);
                        setPopoverOpen(false);
                      }}
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

  const processandoFila = tarefasFila.filter(t => t.status !== 'arquivada'); 
  const concluidasFila = tarefasFila.filter(t => t.status === 'concluído' || t.status === 'erro');

  const totalGeral = faturas.length;
  const apuradasGeral = faturas.filter(f => f.apuracao === 'Sim').length;
  const pendentesGeral = totalGeral - apuradasGeral;
  
  // Math.floor garante que 99.9% seja 99%. Só será 100% quando realmente a divisão for inteira (100).
  let percentualApuracao = totalGeral > 0 ? Math.floor((apuradasGeral / totalGeral) * 100) : 0;
  
  // Trava de segurança extra solicitada: se falta 1 empresa, nunca exibir 100%
  if (apuradasGeral > 0 && apuradasGeral < totalGeral && percentualApuracao === 100) {
    percentualApuracao = 99;
  }


  return (
    <div className="space-y-6 font-['Poppins'] pb-10 relative">
      
      {/* CABEÇALHO */}
      <div className="mb-8 flex items-center justify-between px-2">
        <div className="flex items-center gap-5">
          <div className="w-14 h-14 bg-brand-yellow/10 rounded-2xl flex items-center justify-center shrink-0 text-brand-yellow">
            <DollarSign size={28} />
          </div>
          <div className="space-y-2">
            <div className="space-y-0.5">
              <h1 className="text-2xl font-bold text-brand-dark tracking-tight">Controle Mensal - <span className="text-brand-yellow font-medium">Simples Nacional</span></h1>
              <p className="text-[13px] text-gray-500 font-medium">Monitore o faturamento e a conformidade das empresas.</p>
            </div>
            
            {/* AVISO DE ATUALIZAÇÃO */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50/80 border border-blue-100 rounded-md text-blue-600 w-max">
                <Info size={14} className="shrink-0" />
                <span className="text-[11px] font-medium tracking-tight">Base atualizada todo dia às 3h da manhã contendo apenas XMLs do Portal Nacional.</span>
              </div>
              
              <button 
                onClick={() => setIsHelpModalOpen(true)} 
                className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-md text-gray-600 hover:bg-gray-100 hover:text-brand-dark transition-colors w-max cursor-pointer"
              >
                <BookOpen size={14} className="shrink-0" />
                <span className="text-[11px] font-bold tracking-tight uppercase">Entenda as Colunas</span>
              </button>
            </div>
          </div>
        </div>

        <button onClick={() => setIsAcompanhamentoOpen(true)} className="flex items-center gap-2 bg-white border-2 border-brand-yellow text-brand-dark px-5 py-3 rounded-xl font-black text-xs hover:bg-brand-yellow hover:text-white transition-all shadow-sm group">
          {processandoFila.length > 0 ? <Loader2 size={18} className="animate-spin text-white" /> : <ListTodo size={18} className="text-brand-yellow group-hover:text-white transition-colors" />}
          Monitor de Guias {processandoFila.length > 0 && `(${processandoFila.length})`}
        </button>
      </div>

      <div className="flex flex-col gap-3 bg-white p-4 rounded-xl shadow-sm border border-gray-100 relative z-10 w-full">
        <div className="flex flex-col lg:flex-row items-center justify-between gap-4">
          
          <div className="flex items-center gap-2 bg-gray-50 p-1 rounded-lg border border-gray-100 w-full lg:w-auto justify-center">
            <button onClick={() => shiftMonth(-1)} className="p-1.5 text-brand-dark hover:bg-white rounded transition-all"><ChevronLeft size={18} /></button>
            <div className="flex items-center gap-2 px-2">
              <Calendar size={14} className="text-brand-yellow shrink-0" />
              <DatePicker
                selected={mesano && mesano.includes('-') ? new Date(parseInt(mesano.split('-')[0]), parseInt(mesano.split('-')[1]) - 1, 1) : new Date()}
                onChange={(date: Date | null) => {
                  if (date) {
                    setMesano(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`);
                  }
                }}
                dateFormat="MMMM yyyy"
                showMonthYearPicker
                locale="pt-BR"
                className="bg-transparent border-none font-bold text-xs text-brand-dark focus:ring-0 cursor-pointer uppercase w-28.75 p-0 text-center outline-none"
              />
            </div>
            <button onClick={() => shiftMonth(1)} className="p-1.5 text-brand-dark hover:bg-white rounded transition-all"><ChevronRight size={18} /></button>
          </div>

          <div className="flex items-center gap-2 w-full lg:w-auto justify-center">
            <div className="relative flex-1 lg:flex-none" ref={downloadDropdownRef}>
              <button 
                onClick={() => setIsDownloadMenuOpen(!isDownloadMenuOpen)} 
                disabled={selectedCodigos.length === 0} 
                className={`w-full flex items-center gap-2 px-4 py-2 rounded-lg font-black text-[10px] uppercase tracking-widest transition-all whitespace-nowrap justify-center ${selectedCodigos.length > 0 ? 'bg-brand-yellow text-white shadow-sm cursor-pointer' : 'bg-gray-50 border border-gray-200 text-gray-300 cursor-not-allowed'}`}
              >
                <Download size={14} /> Baixar Lote <ChevronDown size={12} className={`transition-transform ${isDownloadMenuOpen ? 'rotate-180' : ''}`} />
              </button>
              
              {isDownloadMenuOpen && selectedCodigos.length > 0 && (
                <div className="absolute top-full left-0 mt-2 w-48 bg-white border border-gray-100 rounded-xl shadow-xl z-50 flex flex-col p-1 animate-in zoom-in-95 duration-100">
                  <button onClick={() => handleDownloadLote('ambos')} className="flex items-center gap-2 px-3 py-2.5 text-[10px] font-black uppercase text-brand-dark hover:bg-brand-yellow/10 rounded-lg transition-colors w-full text-left">
                    PGDAS e DAS
                  </button>
                  <button onClick={() => handleDownloadLote('pgdas')} className="flex items-center gap-2 px-3 py-2.5 text-[10px] font-black uppercase text-gray-600 hover:bg-gray-50 rounded-lg transition-colors w-full text-left">
                    Somente PGDAS
                  </button>
                  <button onClick={() => handleDownloadLote('das')} className="flex items-center gap-2 px-3 py-2.5 text-[10px] font-black uppercase text-gray-600 hover:bg-gray-50 rounded-lg transition-colors w-full text-left">
                    Somente DAS
                  </button>
                </div>
              )}
            </div>

            <button 
              onClick={() => handleRecalcularXML(selectedCodigos)} 
              disabled={isBatchProcessing || selectedCodigos.length === 0} 
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-black text-[10px] uppercase tracking-widest transition-all whitespace-nowrap flex-1 lg:flex-none justify-center ${selectedCodigos.length > 0 ? 'bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100 hover:text-blue-700 shadow-sm cursor-pointer' : 'bg-gray-50 border border-gray-200 text-gray-300 cursor-not-allowed'}`}
            >
              <RefreshCw size={14} /> Atualizar Faturamento
            </button>

            <button onClick={handleSolicitarLote} disabled={isBatchProcessing || selectedCodigos.length === 0} className={`flex items-center gap-2 px-4 py-2 rounded-lg font-black text-[10px] uppercase tracking-widest transition-all whitespace-nowrap flex-1 lg:flex-none justify-center ${selectedCodigos.length > 0 ? 'bg-brand-dark text-white hover:text-brand-yellow shadow-md cursor-pointer' : 'bg-gray-50 border border-gray-200 text-gray-300 cursor-not-allowed'}`}>
              <PlayCircle size={14} /> {isBatchProcessing ? 'Enviando...' : `Transmitir Lote (${selectedCodigos.length})`}
            </button>

            <button onClick={() => fetchData()} className="flex items-center justify-center shrink-0 w-9 h-9 border border-gray-200 text-brand-dark rounded-lg font-black hover:bg-gray-50 transition-all"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>

            <button onClick={handleExportarExcel} className="flex items-center gap-2 bg-brand-dark text-white px-4 py-2 rounded-lg font-black text-[10px] uppercase tracking-widest hover:text-brand-yellow transition-all whitespace-nowrap">
              <Download size={14} /> EXCEL
            </button>
          </div>
        </div>

        <div className="w-full h-px bg-gray-50"></div>

        <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto lg:justify-end">
            <div className="relative flex-1 lg:w-87.5">
              <Search className="absolute left-3 top-2.5 text-gray-500" size={16} />
              <input type="text" placeholder="Buscar por Empresa, Código ou CNPJ..." value={busca} onChange={(e) => setBusca(e.target.value)} className="pl-9 pr-3 py-2 bg-gray-50 border border-transparent rounded-lg text-xs font-bold outline-none focus:bg-white focus:border-gray-200 w-full text-brand-dark" />
            </div>

        <div className="flex flex-col lg:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 w-full lg:w-auto">
            <button onClick={() => setFiltroDifFaturamento(!filtroDifFaturamento)} className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all border flex-1 lg:flex-none ${filtroDifFaturamento ? 'bg-red-50 border-red-200 text-red-600' : 'bg-gray-50 border-transparent text-gray-500 hover:bg-gray-100 hover:text-gray-600'}`}>
              <AlertTriangle size={12} className={filtroDifFaturamento ? 'text-red-500' : 'text-gray-500'} /> Dif. Fat
            </button>
            <button onClick={() => setFiltroDifDeclaracao(!filtroDifDeclaracao)} className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all border flex-1 lg:flex-none ${filtroDifDeclaracao ? 'bg-red-50 border-red-200 text-red-600' : 'bg-gray-50 border-transparent text-gray-500 hover:bg-gray-100 hover:text-gray-600'}`}>
              <AlertTriangle size={12} className={filtroDifDeclaracao ? 'text-red-500' : 'text-gray-500'} /> Dif. Dec
            </button>
          </div>          

            {hasActiveFilters && (
              <button onClick={limparTodosOsFiltros} className="shrink-0 text-[9px] uppercase font-bold text-red-400 hover:text-red-600 px-2 transition-colors whitespace-nowrap">Limpar Filtros</button>
            )}
          </div>
        </div>
      </div>

      {/* --- NOVA BARRA DE PROGRESSO DE APURAÇÃO --- */}
      {!loading && totalGeral > 0 && (
        <div className={`flex items-center justify-between p-3 rounded-xl border ${percentualApuracao === 100 ? 'bg-green-50/50 border-green-200 text-green-700' : 'bg-yellow-55 border-brand-yellow text-yellow-700'} shadow-sm relative z-0 transition-colors`}>
          <div className="flex items-center gap-3">
            <div className={`w-6 h-6 rounded-full border flex items-center justify-center shrink-0 ${percentualApuracao === 100 ? 'border-green-400 text-green-600 bg-green-100' : 'border-brand-yellow text-yellow-500 bg-yellow-50'}`}>
              <Info size={14} />
            </div>
            <div className="text-[13px] font-medium tracking-tight">
              {percentualApuracao === 100 ? (
                <span><strong>Nenhuma empresa pendente</strong> de apuração nesta competência. O ciclo está completo.</span>
              ) : (
                <span><strong className="text-yellow-700 bg-white px-1.5 py-0.5 rounded border border-2-brand-yellow mr-1">{pendentesGeral}</strong> Empresas pendentes de apuração do total de <strong>{totalGeral}</strong>.</span>
              )}
            </div>
          </div>
          
          <div className="flex items-center gap-4 w-1/4" style={{ minWidth: '200px' }}>
             <div className="w-full bg-yellow-50 h-2.5 rounded-full overflow-hidden border border-yellow-400/50">
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
      
      <div className="relative z-0 group/tablebox"> 
        {/* BOTÕES DE ROLAGEM FLUTUANTES */}
        <button 
          onClick={() => handleScrollTable('left')} 
          className="absolute -left-5 top-1/2 -translate-y-1/2 z-40 bg-white/90 backdrop-blur text-brand-dark p-2 rounded-full shadow-[0_4px_12px_rgba(0,0,0,0.15)] border border-gray-100 opacity-0 pointer-events-none group-hover/tablebox:opacity-100 group-hover/tablebox:pointer-events-auto transition-all hover:bg-brand-yellow hover:text-white cursor-pointer"
          title="Rolar para a esquerda"
        >
          <ChevronLeft size={24} />
        </button>
        <button 
          onClick={() => handleScrollTable('right')} 
          className="absolute -right-5 top-1/2 -translate-y-1/2 z-40 bg-white/90 backdrop-blur text-brand-dark p-2 rounded-full shadow-[0_4px_12px_rgba(0,0,0,0.15)] border border-gray-100 opacity-0 pointer-events-none group-hover/tablebox:opacity-100 group-hover/tablebox:pointer-events-auto transition-all hover:bg-brand-yellow hover:text-white cursor-pointer"
          title="Rolar para a direita"
        >
          <ChevronRight size={24} />
        </button>

        {/* CAIXA DA TABELA: Mantém as bordas arredondadas originais intactas */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          {/* Adicionado o ref=tableScrollRef aqui */}
          <div className="overflow-x-auto custom-scrollbar pb-4 min-h-87.5" ref={tableScrollRef}>
            <table className="w-full min-w-max text-left text-sm">   
            <thead>
              <tr>
                <th className="p-3 align-middle bg-brand-panel w-12 text-center border-r border-gray-50 border-b">
                  <input type="checkbox" checked={isAllSelected} onChange={handleSelectAll} disabled={faturasFiltradas.length === 0} style={{ accentColor: '#fdb913' }} className="w-4 h-4 rounded border-gray-300 cursor-pointer" />
                </th>
                
                {renderTh('Cliente', 'empresa', 'left')}                
                {renderExcelTh('XML Portal', 'total', filtroValoresTotal, setFiltroValoresTotal, popoverTotalAberto, setPopoverTotalAberto, popoverTotalRef, valoresTotalUnicos, formatBRL, 'left')}                
                {renderExcelTh('Sybase Domínio', 'dominio', filtroValoresDominio, setFiltroValoresDominio, popoverDominioAberto, setPopoverDominioAberto, popoverDominioRef, valoresDominioUnicos, formatBRL, 'left')}
                {renderExcelTh('Cód. Trib.', 'cTribNac', filtroTribNac, setFiltroTribNac, popoverTribNacAberto, setPopoverTribNacAberto, popoverTribNacRef, valoresTribNacUnicos, (v) => String(v), 'center')}
                {renderExcelTh('Apurado', 'apuracao', filtroApuracao, setFiltroApuracao, popoverApuracaoAberto, setPopoverApuracaoAberto, popoverApuracaoRef, valoresApuracaoUnicos, (v) => v === 'Sim' ? 'Apurado' : 'Não Apurado', 'center')}                
                {renderExcelTh('Fator R', 'fator_r_percentual', filtroFatorR, setFiltroFatorR, popoverFatorRAberto, setPopoverFatorRAberto, popoverFatorRRef, valoresFatorRUnicos, (v) => v === 'risco' ? 'Risco' : v === 'atencao' ? 'Atenção' : v === 'seguro' ? 'Seguro' : 'Sem Fator', 'center')}
                {renderExcelTh('Transmissão PGDAS', 'declarado', filtroSerpro, setFiltroSerpro, popoverSerproAberto, setPopoverSerproAberto, popoverSerproRef, valoresSerproUnicos, (v) => v === 'transmitidas' ? 'Transmitidas' : v === 'nao_transmitidas' ? 'Pendentes' : v === 'erro' ? 'Com Erro' : v === 'com_diferenca' ? 'Com Diferença' : v, 'left')}                
                {renderExcelTh('Envio Guia', 'guia_enviada', filtroOnvio, setFiltroOnvio, popoverOnvioAberto, setPopoverOnvioAberto, popoverOnvioRef, valoresOnvioUnicos, (v) => v === 'publicadas' ? 'No Onvio' : v === 'pendentes' ? 'Falta Postar' : v === 'isento' ? 'DAS Isento' : v, 'center')}               
                {renderExcelTh('Conferência', 'conferencia', filtroConferencia, setFiltroConferencia, popoverConferenciaAberto, setPopoverConferenciaAberto, popoverConferenciaRef, valoresConferenciaUnicos, (v) => v === 'conferidos' ? 'Conferidos' : 'Pendentes', 'center')} 
                               
                <th className="p-3 text-center bg-brand-panel font-black uppercase text-[10px] text-gray-500 sticky right-0 shadow-[-4px_0_10px_rgba(0,0,0,0.02)] z-10 w-20 border-l border-b border-gray-50">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50" ref={dropdownRef}>
              {loading ? (
                <tr><td colSpan={9} className="p-10 text-center text-gray-300 italic animate-pulse font-bold">Consultando dados...</td></tr>
              ) : faturasPaginadas.length === 0 ? (
                <tr><td colSpan={9} className="p-10 text-center text-gray-500 font-bold">Nenhum faturamento encontrado.</td></tr>
              ) : faturasPaginadas.map((f, index) => {
                
                const isFirstRows = index < 3;
                const isLastRows = index >= faturasPaginadas.length - 3 && faturasPaginadas.length >= 3;
                const infoValidacao = validados[f.cod];
                const isValidado = !!infoValidacao; 

                // ALERTA ESPECÍFICO: Apuração tem diferença E a declaração é mais velha que a última atualização do faturamento
                const isDesatualizadaPorData = !f.data_declaracao_raw || new Date(f.ultima_raw!) > new Date(f.data_declaracao_raw);
                const isDeclaracaoDesatualizada = f.declarado !== null && f.declarado !== undefined && Math.abs(Number(f.dif_declaracao)) >= 0.01 && isDesatualizadaPorData;
                
                const isFilial = checkIsFilial(f.cnpj);

                return (
                <tr key={f.cod} className={`hover:bg-gray-50/80 transition-colors group ${selectedCodigos.includes(f.cod) ? 'bg-yellow-50/30' : isDeclaracaoDesatualizada && !isFilial ? 'bg-red-100/80' : ''}`}>
                  
                  <td className="p-3 align-top text-center border-r border-gray-50">
                    <input type="checkbox" checked={selectedCodigos.includes(f.cod)} onChange={() => handleSelectRow(f.cod)} style={{ accentColor: '#fdb913' }} className="w-4 h-4 rounded border-gray-300 cursor-pointer mt-1" />
                  </td>

                  <td className="p-3 align-top max-w-70">
                    <div className="flex flex-col gap-0.5">
                      <div className="font-bold text-brand-dark truncate flex items-center gap-1.5" title={f.empresa}>
                        <span className="text-brand-yellow mr-1.5 font-black">{f.cod}</span>
                        {f.empresa}
                        
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
                      <div className="text-[12px] font-bold text-gray-500 font-mono tracking-tighter">{f.cnpj}</div>
                    </div>
                  </td>

                  <td className="p-3 align-top">
                    <div className="flex flex-col min-w-27.5">
                      <span className="font-medium text-gray-600 text-sm">{formatBRL(f.total)}</span>
                      <span className="text-[9px] text-gray-500 mt-0.5 uppercase">Atualizado: {f.ultima}</span>
                    </div>
                  </td>

                  <td className="p-3 align-top">
                    <div className="flex flex-col min-w-27.5">
                      <span className="font-medium text-gray-600 text-sm">{formatBRL(f.dominio)}</span>
                      <span className={`text-[10px] font-bold mt-0.5 ${Math.abs(f.diferenca) < 0.01 ? 'text-green-500' : 'text-red-500'}`}>Dif: {formatBRL(f.diferenca)}</span>
                    </div>
                  </td>

                  <td className="p-3 align-top text-center">
                    {f.cTribNac && f.cTribNac.length > 0 ? (
                      f.cTribNac.length === 1 ? (
                        <span className="px-2 py-1 rounded-md text-[10px] font-black border bg-gray-50 text-gray-600 border-gray-200 inline-block mt-1">
                          {f.cTribNac[0]}
                        </span>
                      ) : (
                        <div className="group/trib relative inline-block mt-1">
                          <span className="px-2 py-1 rounded-md text-[10px] font-black border bg-blue-50 text-blue-600 border-blue-200 cursor-help flex items-center gap-1">
                            {f.cTribNac[0]} 
                            <span className="text-[8px] bg-blue-100 text-blue-700 px-1 py-0.5 rounded leading-none">
                              +{f.cTribNac.length - 1}
                            </span>
                          </span>
                          
                          {/* Tooltip com todos os códigos */}
                          <div className={`absolute ${isFirstRows ? 'top-full mt-2' : 'bottom-full mb-2'} left-1/2 -translate-x-1/2 w-max max-w-50 bg-brand-dark text-white text-[10px] font-medium p-3 rounded-xl opacity-0 group-hover/trib:opacity-100 transition-opacity pointer-events-none z-50 text-center shadow-xl`}>
                            <strong className="text-brand-yellow block mb-2 text-xs">Códigos de Tributação</strong>
                            <div className="flex flex-wrap gap-1.5 justify-center">
                              {f.cTribNac.map(cod => (
                                <span key={cod} className="bg-white/10 px-1.5 py-0.5 rounded border border-white/20">
                                  {cod}
                                </span>
                              ))}
                            </div>
                            {/* Setinha do tooltip */}
                            <div className={`absolute ${isFirstRows ? 'bottom-full -mb-px border-b-brand-dark' : 'top-full -mt-1 border-t-brand-dark'} left-1/2 -translate-x-1/2 border-4 border-transparent`}></div>
                          </div>
                        </div>
                      )
                    ) : (
                      <span className="text-gray-300 font-bold mt-1 inline-block">—</span>
                    )}
                  </td>

                  <td className="p-3 align-top text-center">
                    <span className={`px-3 py-1 rounded-md text-[9px] font-black uppercase border w-max text-center inline-block mt-1 ${f.apuracao === 'Sim' ? 'bg-green-50 text-green-600 border-green-100' : 'bg-red-50 text-red-600 border-red-100'}`}>
                      {f.apuracao === 'Sim' ? 'Sim' : 'Não'}
                    </span>
                  </td>

                  <td className="p-3 align-top text-center">
                    {typeof f.fator_r_percentual === 'number' ? (
                      <span className={`px-2.5 py-1 rounded-md text-[10px] font-black uppercase border w-max text-center inline-block mt-1 ${
                        f.fator_r_percentual < 2800 ? 'bg-red-50 text-red-600 border-red-100' :
                        f.fator_r_percentual <= 3000 ? 'bg-yellow-50 text-yellow-600 border-yellow-100' :
                        'bg-green-50 text-green-600 border-green-100'
                      }`}>
                        {formatPercentDisplay(f.fator_r_percentual)}
                      </span>
                    ) : (
                      <span className="text-gray-300 font-bold mt-1 inline-block">-</span>
                    )}
                  </td>

                  <td className="p-3 align-top bg-gray-50/30 border-l border-r border-gray-50">
                    {isFilial ? (
                      <div className="flex items-center justify-center h-full mt-2">
                         <span className="text-gray-300 font-bold">—</span>
                      </div>
                    ) : (
                      <div className="flex flex-col min-w-27.5">
                        {f.erro_texto ? (
                          <div className="flex flex-col gap-1 group/err relative">
                            <span className="text-[10px] font-black text-red-500 uppercase flex items-center gap-1 cursor-help w-max">
                              <AlertTriangle size={12}/> Erro Envio
                            </span>
                            <span className="text-[9px] text-gray-500 leading-tight line-clamp-2 max-w-37.5" title={f.erro_texto}>
                              {f.erro_texto}
                            </span>
                          </div>
                        ) : f.declarado !== null && f.declarado !== undefined ? (
                          <>
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-brand-dark text-sm">
                                {formatBRL(f.declarado)}
                              </span>
                              
                              {/* ÍCONE DE ALERTA COM TOOLTIP INTELIGENTE */}
                              {isDeclaracaoDesatualizada && (
                                <div className="group/warn relative flex items-center">
                                  <AlertTriangle size={14} className="text-red-500 fill-red-100 cursor-help animate-pulse" />
                                  <div className={`absolute ${isFirstRows ? 'top-full mt-2' : 'bottom-full mb-2'} left-1/2 -translate-x-1/2 w-72 bg-brand-dark text-white text-[10px] font-medium p-3 rounded-xl opacity-0 group-hover/warn:opacity-100 transition-opacity pointer-events-none z-50 text-center shadow-xl leading-relaxed`}>
                                    <strong className="text-red-400 block mb-1 text-xs">Declaração Desatualizada!</strong>
                                    <div className="space-y-1 mb-2 text-left bg-white/5 p-2 rounded-lg border border-white/10">
                                      <p><span className="text-gray-400">Declarado:</span> {f.data_declaracao || 'Anterior'}</p>
                                      <p><span className="text-gray-400">Faturado:</span> {f.ultima}</p>
                                    </div>
                                    A declaração foi transmitida {f.declarado === 0 ? 'zerada' : `com imposto de ${formatBRL(f.declarado)}`}, o que diverge da apuração atual. Transmita uma Retificadora.
                                    
                                    {/* Seta do tooltip muda de direção */}
                                    <div className={`absolute ${isFirstRows ? 'bottom-full -mb-px border-b-brand-dark' : 'top-full -mt-1 border-t-brand-dark'} left-1/2 -translate-x-1/2 border-4 border-transparent`}></div>
                                  </div>
                                </div>
                              )}
                            </div>

                            <div className="flex flex-col mt-0.5">
                              <span className={`text-[9.5px] font-bold ${Math.abs(Number(f.dif_declaracao)) < 0.01 ? 'text-green-500' : 'text-gray-500'}`}>
                                Domínio: {formatBRL(f.imposto_dominio)}
                              </span>
                              {Math.abs(Number(f.dif_declaracao)) >= 0.01 && (
                                <span className="text-[9.5px] font-black text-red-500 mt-0.5">
                                  Dif: {formatBRL(Number(f.dif_declaracao))}
                                </span>
                              )}
                            </div>
                          </>
                        ) : (
                          <span className="text-[10px] font-bold text-gray-500 mt-1">Pendente</span>
                        )}
                      </div>
                    )}
                  </td>

                  {/* COLUNA ENVIO GUIA */}
                  <td className="p-3 align-middle text-center">
                    {isFilial ? (
                      <span className="text-gray-300 font-bold">—</span>
                    ) : (
                      <div className="flex flex-col gap-1.5 w-max mx-auto">
                        
                        {/* TAG PGDAS */}
                        <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase flex items-center justify-between gap-2 border transition-all ${
                          f.pgdas_onvio 
                            ? 'bg-green-50 text-green-600 border-green-200' 
                            : f.declarado !== null && f.declarado !== undefined 
                              ? 'bg-red-50 text-red-600 border-red-300'     
                              : 'bg-gray-50 text-gray-400 border-gray-200'  
                        }`}>
                          PGDAS 
                          {f.pgdas_onvio ? <CheckCircle2 size={10} /> : f.declarado !== null && f.declarado !== undefined ? <AlertTriangle size={10} /> : <span className="opacity-50">...</span>}
                        </span>

                        {/* TAG DAS */}
                        {f.declarado !== null && f.declarado > 0 ? (
                          <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase flex items-center justify-between gap-2 border transition-all ${
                            f.das_onvio 
                              ? 'bg-green-50 text-green-600 border-green-200' 
                              : 'bg-red-50 text-red-600 border-red-300'       
                          }`}>
                            DAS 
                            {f.das_onvio ? <CheckCircle2 size={10} /> : <AlertTriangle size={10} />}
                          </span>
                        ) : f.declarado !== null && f.declarado === 0 ? (
                          <span 
                            className={`px-2 py-0.5 rounded text-[9px] font-black uppercase flex items-center justify-center border gap-1 transition-all ${
                              f.total > 0 
                                ? 'bg-red-50 text-red-600 border-red-400 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.3)]' 
                                : 'bg-blue-50 text-blue-500 border-blue-200' 
                            }`} 
                            title={f.total > 0 ? "Atenção: Faturamento detectado no XML, mas imposto zerado na Domínio!" : "Sem imposto a pagar nesta competência"}
                          >
                            {f.total > 0 && <AlertTriangle size={10} />}
                            DAS ISENTO
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase flex items-center justify-between gap-2 border bg-gray-50 text-gray-400 border-gray-200">
                            DAS <span className="opacity-50">...</span>
                          </span>
                        )}

                      </div>
                    )}
                  </td>

                  {/* <-- BOTÃO E INFO DE MARCAR COMO CONFERIDO --> */}
                  <td className="p-3 align-middle text-center border-l border-gray-50">
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
                  
                  <td className="p-3 align-middle text-center sticky right-0 bg-white group-hover:bg-gray-50/80 shadow-[-4px_0_10px_rgba(0,0,0,0.02)] transition-colors border-l border-gray-50 z-10 w-20 ">
                     <div className="relative">
                       <button onClick={() => setDropdownOpen(dropdownOpen === f.cod ? null : f.cod)} className="p-2 text-gray-500 hover:text-brand-dark hover:bg-gray-100 rounded-lg transition-all">
                         <MoreVertical size={18} className="mx-auto" />
                       </button>

                       {dropdownOpen === f.cod && (
                         <div className={`absolute right-8 ${isLastRows ? 'bottom-0' : 'top-0'} w-44 bg-white border border-gray-100 rounded-xl shadow-xl z-60 flex flex-col p-1 animate-in zoom-in-95 duration-100`}>
                           {f.declarado !== null && f.declarado !== undefined && (
                             <>
                               <button onClick={() => handleDownloadGuia(f.cod, 'pgdas')} className="flex items-center gap-2 px-3 py-2 text-[10px] font-black uppercase text-brand-dark hover:bg-brand-yellow/10 rounded-lg transition-colors w-full text-left">
                                 <Download size={12} className="text-brand-yellow" /> PGDAS
                               </button>
                               {f.declarado > 0 && (
                                 <button onClick={() => handleDownloadGuia(f.cod, 'das')} className="flex items-center gap-2 px-3 py-2 text-[10px] font-black uppercase text-brand-dark hover:bg-brand-yellow/10 rounded-lg transition-colors w-full text-left">
                                   <Download size={12} className="text-brand-yellow" /> DAS
                                 </button>
                               )}
                               <div className="w-full h-px bg-gray-100 my-1"></div>
                             </>
                           )}
                           
                           {(!f.pgdas_onvio) && (
                             <button onClick={() => handleSolicitarPGDAS(f, 1)} className="flex items-center gap-2 px-3 py-2 text-[10px] font-black uppercase text-brand-dark hover:bg-gray-50 rounded-lg transition-colors w-full text-left">
                               <PlayCircle size={12} className="text-green-500" /> Transmitir Original
                             </button>
                           )}

                           {(f.erro_texto?.toLowerCase().includes('retificadora') || f.pgdas_onvio) && (
                             <button onClick={() => handleSolicitarPGDAS(f, 2)} className="flex items-center gap-2 px-3 py-2 text-[10px] font-black uppercase text-red-500 hover:bg-red-50 rounded-lg transition-colors w-full text-left">
                               <RotateCcw size={12} /> Transmitir Retificadora
                             </button>
                           )}
                         </div>
                       )}
                     </div>
                  </td>
                </tr>
              )})}
            </tbody>
          </table>
        </div>
        
        {!loading && faturasFiltradas.length > 0 && (
          <div className="bg-white border-t border-gray-100 p-4 flex items-center justify-between text-[10px] font-black text-gray-500 uppercase tracking-widest z-20">
            <div>Mostrando <span className="text-brand-dark">{indexInicio + 1} - {Math.min(indexInicio + itensPorPagina, faturasFiltradas.length)}</span> de {faturasFiltradas.length}</div>
            <div className="flex items-center gap-3">
              <button onClick={() => setPaginaAtual(prev => Math.max(prev - 1, 1))} disabled={paginaAtual === 1} className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-20 transition-all text-brand-dark"><ChevronLeft size={16} /></button>
              <span className="text-brand-dark font-black">Pág {paginaAtual} / {totalPaginas}</span>
              <button onClick={() => setPaginaAtual(prev => Math.min(prev + 1, totalPaginas))} disabled={paginaAtual === totalPaginas} className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-20 transition-all text-brand-dark"><ChevronRight size={16} /></button>
            </div>
          </div>
        )}
      </div>
      </div>

      {/* MODAL DE CONFIRMAÇÃO DE ERROS/REGRAS */}
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

      {/* MODAL DIFERENÇA PGDAS */}
      {alertDiferencas && pendingSubmit && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-60 p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-[25px] shadow-2xl w-full max-w-xl overflow-hidden flex flex-col border border-gray-100 animate-in zoom-in-95 duration-200">
            <div className="bg-brand-dark px-6 py-4 flex items-center justify-between border-b-4 border-brand-yellow">
              <div className="flex items-center gap-2 text-white">
                <AlertTriangle size={20} className="text-brand-yellow" />
                <h2 className="font-bold text-lg tracking-tight">{alertDiferencas.length > 1 ? 'Atenção ao Lote' : 'Atenção'}</h2>
              </div>
              <button onClick={() => { setAlertDiferencas(null); setPendingSubmit(null); }} className="text-gray-500 hover:text-white transition-colors"><X size={22} /></button>
            </div>
            <div className="p-8 space-y-5 text-center">
              <div className="bg-red-50 text-red-600 p-4 rounded-xl border border-red-100 text-sm font-medium">Detectamos divergências de faturamento {alertDiferencas.length > 1 ? 'nas seguintes empresas selecionadas:' : 'nesta empresa:'}</div>
              <div className="max-h-48 overflow-y-auto custom-scrollbar bg-gray-50 border border-gray-100 rounded-xl p-4 text-left">
                {alertDiferencas.map(f => (
                  <div key={f.cod} className="flex items-center justify-between py-2 border-b border-gray-200 last:border-0">
                    <span className="text-xs font-bold text-brand-dark truncate max-w-62.5"><span className="text-gray-500 mr-1">{f.cod}</span>{f.empresa}</span>
                    <span className="text-xs font-black text-red-500 whitespace-nowrap ml-4">{formatBRL(f.diferenca)}</span>
                  </div>
                ))}
              </div>
              <p className="text-brand-dark text-sm leading-relaxed font-bold px-4">Deseja prosseguir com a transmissão mesmo assim?</p>
              <div className="flex gap-4 pt-2">
                <button onClick={() => { setAlertDiferencas(null); setPendingSubmit(null); }} className="flex-1 px-4 py-3.5 bg-gray-50 text-gray-500 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-gray-100 transition-all">Cancelar</button>
                <button onClick={() => executeSolicitacao(pendingSubmit.faturas, pendingSubmit.tipoDeclaracao)} className="flex-1 px-4 py-3.5 bg-red-500 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-red-600 shadow-lg shadow-red-500/20 transition-all">Sim, Transmitir</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MONITOR DE TRANSMISSÕES */}
      {isAcompanhamentoOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-[25px] shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col border border-gray-100 h-[80vh] animate-in zoom-in-95 duration-200">
            
            <div className="bg-brand-dark px-8 py-5 flex items-center justify-between border-b-4 border-brand-yellow shrink-0">
              <div className="flex items-center gap-3 text-white">
                <ListTodo size={24} className="text-brand-yellow" />
                <div>
                  <h2 className="font-bold text-lg tracking-tight">Monitor de Transmissões</h2>
                  <p className="text-[10px] text-gray-500 font-medium uppercase tracking-widest mt-0.5">Acompanhe a fila de processamento em tempo real</p>
                </div>
              </div>
              <button onClick={handleFecharModal} className="text-gray-500 hover:text-white transition-colors p-2 bg-white/5 rounded-full hover:bg-white/10"><X size={24} /></button>
            </div>

            <div className="flex gap-8 border-b border-gray-100 px-8 bg-gray-50 shrink-0 pt-4">
              <button onClick={() => setAbaAcompanhamento('processando')} className={`pb-4 text-xs font-black uppercase tracking-widest transition-all border-b-2 flex items-center gap-2 ${abaAcompanhamento === 'processando' ? 'border-brand-yellow text-brand-dark' : 'border-transparent text-gray-500 hover:text-gray-600'}`}>
                <Loader2 size={16} className={processandoFila.length > 0 ? 'animate-spin text-brand-yellow' : ''} /> Processando ({processandoFila.length})
              </button>
              <button onClick={() => setAbaAcompanhamento('concluidas')} className={`pb-4 text-xs font-black uppercase tracking-widest transition-all border-b-2 flex items-center gap-2 ${abaAcompanhamento === 'concluidas' ? 'border-brand-yellow text-brand-dark' : 'border-transparent text-gray-500 hover:text-gray-600'}`}>
                <CheckCheck size={16} className={concluidasFila.length > 0 ? 'text-green-500' : ''} /> Concluídas/Falhas ({concluidasFila.length})
              </button>
            </div>

            <div className="p-6 flex-1 overflow-y-auto bg-gray-50/30">
              
              {abaAcompanhamento === 'processando' && (
                <div className="space-y-4">
                  {processandoFila.length === 0 ? (
                    <div className="text-center py-20 text-gray-500 font-bold">Nenhuma empresa sendo processada no momento.</div>
                  ) : (
                    processandoFila.map((tarefa, idx) => (
                      <div key={idx} className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm flex flex-col gap-4 relative overflow-hidden">
                        <div className={`absolute top-0 left-0 w-1 h-full ${
                          tarefa.status === 'erro' ? 'bg-red-500' : 
                          tarefa.status === 'concluído' ? 'bg-green-500' : 
                          'bg-brand-yellow'
                        }`}></div>
                        
                        <div className="flex justify-between items-start">
                          <div className="flex flex-col gap-0.5">
                            <div className="font-bold text-brand-dark text-sm">
                              <span className="text-brand-yellow mr-1.5 font-black">{tarefa.cliente_cod}</span>
                              {tarefa.empresa || 'Empresa em processamento'}
                            </div>
                            <p className="text-[10px] text-gray-500 font-mono tracking-tighter">
                              {tarefa.cnpj} • Enviado por {tarefa.username}
                            </p>
                          </div>
                          
                          <span className={`text-[10px] font-black uppercase px-3 py-1 rounded-lg border ${
                            tarefa.status === 'erro' ? 'bg-red-50 text-red-600 border-red-200' :
                            tarefa.status === 'concluído' ? 'bg-green-50 text-green-600 border-green-200' :
                            'bg-yellow-50 text-yellow-700 border-yellow-100 animate-pulse'
                          }`}>
                            {tarefa.status === 'erro' ? 'Falhou' : 
                             tarefa.status === 'concluído' ? 'Finalizado' : 
                             'Acessando Serpro...'}
                          </span>
                        </div>
                        
                        <div className="space-y-3 mt-2">
                          
                          <div className="space-y-1.5">
                            <div className="flex justify-between text-[9px] font-black uppercase tracking-widest text-gray-500">
                              <span>PGDAS</span>
                              <span className={
                                tarefa.step?.includes('erro') ? 'text-red-500' : 
                                tarefa.step?.includes('concluido') || tarefa.step?.includes('das_') ? 'text-green-500' : 
                                'text-brand-yellow animate-pulse'
                              }>
                                {tarefa.step === 'pgdas_processando' ? 'Enviando...' : 
                                 tarefa.step === 'pgdas_retificando' ? 'Tentando Retificadora...' :
                                 tarefa.step === 'pgdas_erro' ? 'Falha na Transmissão' : 
                                 tarefa.step?.includes('concluido') || tarefa.step?.includes('das_') ? 'Concluído' : 
                                 'Aguardando...'}
                              </span>
                            </div>
                            <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full transition-all duration-700 ${
                                tarefa.step?.includes('concluido') || tarefa.step?.includes('das_') ? 'bg-green-500 w-full' :
                                tarefa.step === 'pgdas_erro' ? 'bg-red-500 w-full' :
                                tarefa.step === 'pgdas_processando' || tarefa.step === 'pgdas_retificando' ? 'bg-brand-yellow w-[60%] relative' : 'w-0'
                              }`}>
                                {(tarefa.step === 'pgdas_processando' || tarefa.step === 'pgdas_retificando') && (
                                  <div className="absolute inset-0 bg-white/20 animate-[shimmer_1s_infinite_linear] bg-size-[200%_100%]"></div>
                                )}
                              </div>
                            </div>
                          </div>
                          
                          <div className="space-y-1.5 mt-2">
                            <div className="flex justify-between text-[9px] font-black uppercase tracking-widest text-gray-500">
                              <span>DAS</span>
                              <span className={
                                tarefa.step === 'das_erro' ? 'text-red-500' : 
                                tarefa.step === 'das_concluido' || tarefa.step === 'das_isento' ? 'text-green-500' : 
                                tarefa.step === 'das_processando' ? 'text-brand-yellow animate-pulse' : 
                                'text-gray-500'
                              }>
                                {tarefa.step === 'das_processando' ? 'Gerando Guia...' : 
                                 tarefa.step === 'das_concluido' ? 'Gerado com Sucesso' : 
                                 tarefa.step === 'das_isento' ? 'Sem imposto devido' : 
                                 tarefa.step === 'das_erro' ? 'Falha no DAS' : 
                                 'Aguardando PGDAS...'}
                              </span>
                            </div>
                            <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full transition-all duration-700 ${
                                tarefa.step === 'das_concluido' || tarefa.step === 'das_isento' ? 'bg-green-500 w-full' :
                                tarefa.step === 'das_erro' ? 'bg-red-500 w-full' :
                                tarefa.step === 'das_processando' ? 'bg-brand-yellow w-[50%] relative' : 'w-0'
                              }`}>
                                {tarefa.step === 'das_processando' && (
                                  <div className="absolute inset-0 bg-white/20 animate-[shimmer_1s_infinite_linear] bg-size-[200%_100%]"></div>
                                )}
                              </div>
                            </div>
                          </div>

                          {tarefa.status === 'erro' && tarefa.error_msg && (
                             <div className="mt-3 p-3 bg-red-50 border border-red-100 rounded-lg text-[10px] font-medium text-red-600 leading-relaxed">
                               <strong className="uppercase font-black text-[9px] tracking-widest mb-1 block">Motivo da Falha:</strong>
                               {tarefa.error_msg}
                             </div>
                          )}

                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {abaAcompanhamento === 'concluidas' && (
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                  {concluidasFila.length === 0 ? (
                     <div className="text-center py-20 text-gray-500 font-bold">Nenhum histórico de conclusão recente.</div>
                  ) : (
                    <>
                      <div className="p-4 bg-brand-panel border-b border-gray-100 flex justify-between items-center">
                        <span className="text-xs font-bold text-gray-500">Últimos processamentos</span>
                        <button onClick={handleDarVistoTodos} className="text-[10px] font-black uppercase bg-green-50 text-green-700 px-3 py-1.5 rounded-lg border border-green-200 hover:bg-green-100 transition-colors flex items-center gap-1.5">
                          <ShieldCheck size={14} /> Dar Visto em Todos
                        </button>
                      </div>
                      <table className="w-full text-left text-sm">
                        <tbody className="divide-y divide-gray-50">
                          {concluidasFila.map((tarefa, idx) => (
                            <tr key={idx} className="hover:bg-gray-50/50 transition-colors">
                              <td className="p-4 align-top w-1/3">
                                <div className="font-bold text-brand-dark max-w-70 truncate">
                                  <span className="text-brand-yellow mr-1.5 font-black">{tarefa.cliente_cod}</span>
                                  {tarefa.empresa || 'Empresa desconhecida'}
                                </div>
                                <div className="text-[10px] text-gray-500 font-mono mt-0.5 tracking-tighter">{tarefa.cnpj}</div>
                              </td>
                              <td className="p-4 align-top">
                                {tarefa.status === 'concluído' ? (
                                  <span className="px-2.5 py-1 rounded text-[9px] font-black uppercase bg-green-50 text-green-600 border border-green-100 flex items-center gap-1 w-max">
                                    <CheckCircle2 size={12} /> Sucesso
                                  </span>
                                ) : (
                                  <div className="flex flex-col gap-1">
                                    <span className="px-2.5 py-1 rounded text-[9px] font-black uppercase bg-red-50 text-red-600 border border-red-100 flex items-center gap-1 w-max">
                                      <AlertTriangle size={12} /> Falha
                                    </span>
                                    <span className="text-[9px] text-gray-500 leading-tight max-w-62.5">{tarefa.error_msg}</span>
                                  </div>
                                )}
                              </td>
                              <td className="p-4 align-top text-[10px] text-gray-500 font-bold uppercase tracking-tighter w-24">
                                Resp: {tarefa.username}
                              </td>
                              <td className="p-4 align-top text-right w-24">
                                <button onClick={() => handleDarVisto(tarefa.id)} className="text-[9px] font-bold text-gray-500 hover:text-green-600 underline">
                                  Dar Visto
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}
                </div>
              )}

            </div>
          </div>
        </div>
      )}
      {/* MODAL DICIONÁRIO DE DADOS */}
      {isHelpModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-70 p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-[25px] shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col border border-gray-100 max-h-[85vh] animate-in zoom-in-95 duration-200">
            <div className="bg-brand-dark px-6 py-4 flex items-center justify-between border-b-4 border-brand-yellow shrink-0">
              <div className="flex items-center gap-2 text-white">
                <BookOpen size={20} className="text-brand-yellow" />
                <h2 className="font-bold text-lg tracking-tight">Entenda as Colunas</h2>
              </div>
              <button onClick={() => setIsHelpModalOpen(false)} className="text-gray-500 hover:text-white transition-colors"><X size={22} /></button>
            </div>
            
            <div className="p-6 overflow-y-auto custom-scrollbar flex-1 bg-gray-50/30">
              <div className="grid gap-4">
                
                <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
                  <h3 className="font-black text-brand-dark text-sm uppercase tracking-widest mb-1">Cliente</h3>
                  <p className="text-sm text-gray-600 leading-relaxed">Exibe o código, razão social e CNPJ da empresa. Um ícone de alerta piscará ao lado do nome caso o Certificado Digital da empresa esteja vencido ou ausente no sistema. Lembrando que quando ajustar o certificado ele vai passar a valer apenas na próxima rotina, ou seja, no dia seguinte ás 3 da manhã.</p>
                </div>

                <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
                  <h3 className="font-black text-brand-dark text-sm uppercase tracking-widest mb-1">XML Portal</h3>
                  <p className="text-sm text-gray-600 leading-relaxed">Apresenta o somatório de faturamento extraído dos XMLs das notas fiscais da nossa base referente ao Portal Nacional. A data mostra quando o robô verificou a última vez, porém lembrando que ele não verifica direto no Portal e sim na nossa base, então não importa quantas vezes clique só é atualizado até 3h da manhã do dia atual.</p>
                </div>

                <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
                  <h3 className="font-black text-brand-dark text-sm uppercase tracking-widest mb-1">Sybase Domínio</h3>
                  <p className="text-sm text-gray-600 leading-relaxed">Mostra o valor de faturamento que está atualmente na domínio. Exibe também a diferença exata entre este valor e o que consta na coluna de XML Portal.</p>
                </div>

                <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
                  <h3 className="font-black text-brand-dark text-sm uppercase tracking-widest mb-1">Cód. Trib.</h3>
                  <p className="text-sm text-gray-600 leading-relaxed">Mostra os códigos de Tributação Nacional do Serviço extraídos dos XMLS das notas fiscais da nossa base referente ao Portal Nacional. Na linha ele sempre mostra só um código (o primeiro encontrado) caso tenha mais que um precisa passar o mouse por cima da linha para verificar. Tag do XML: cTribNac.</p>
                </div>

                <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
                  <h3 className="font-black text-brand-dark text-sm uppercase tracking-widest mb-1">Apurado</h3>
                  <p className="text-sm text-gray-600 leading-relaxed">Indica com <strong>SIM</strong> ou <strong>NÃO</strong> se a empresa já foi apurada na domínio, coleta o estado real atualizado.</p>
                </div>

                <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
                  <h3 className="font-black text-brand-dark text-sm uppercase tracking-widest mb-1">Fator R</h3>
                  <p className="text-sm text-gray-600 leading-relaxed">Exibe o percentual do fator R que é encontrado detalhado na sua própria tela. Esse valor é extraído direto da domínio, para ele existir a empresa precisa obrigatóriamente estar apurada, ser do anexo III ou V e ter gerado o imposto 44.</p>
                </div>

                <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
                  <h3 className="font-black text-brand-dark text-sm uppercase tracking-widest mb-1">Transmissão PGDAS</h3>
                  <p className="text-sm text-gray-600 leading-relaxed">Mostra o valor do imposto transmitido e declarado ao eCAC. Alertas vermelhos e balões informativos aparecerão aqui caso haja erro de comunicação com a Serpro, se a declaração divergir do que está apurado na Domínio, ou se estiver desatualizada (declarada antes do faturamento ser atualizado). Lembrando que a declaração usa o valor da domínio não do sistema então vai depender do total Sybase Domínio.</p>
                </div>

                <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
                  <h3 className="font-black text-brand-dark text-sm uppercase tracking-widest mb-1">Envio Guia</h3>
                  <p className="text-sm text-gray-600 leading-relaxed">Informa se o recibo de declaração (PGDAS) e a guia de pagamento (DAS) foram publicados com sucesso no portal do cliente (Onvio). Se a empresa apresentar faturamento maior que 0 e depois da apuração ficar DAS ISENTO vai ter um alerta para verificarem se o DAS está isento indevidamente. O sistema segue rigorosamente o nome do arquivo que ele gera então se mudarem o nome dos arquivos ao postar ele vai considerar como 'NÃO POSTADO" então se atentar caso haja substituição ele pode dar um "falso" não publicado.</p>
                </div>

                <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm">
                  <h3 className="font-black text-brand-dark text-sm uppercase tracking-widest mb-1">Conferência</h3>
                  <p className="text-sm text-gray-600 leading-relaxed">Coluna de controle interno. Permite que o analista dê um "visto" manual, registrando seu nome e data, para confirmar que aquela empresa foi auditada e está correta.</p>
                </div>

              </div>
            </div>
            
            <div className="p-4 border-t border-gray-100 bg-white">
              <button onClick={() => setIsHelpModalOpen(false)} className="w-full py-3 bg-brand-dark text-white font-black text-xs tracking-widest uppercase rounded-xl hover:text-brand-yellow transition-colors shadow-md">
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

        <style>{`.custom-scrollbar::-webkit-scrollbar{width:8px; height:10px}.custom-scrollbar::-webkit-scrollbar-track{background:#f8fafc;border-radius:4px}.custom-scrollbar::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:4px; border: 2px solid #f8fafc}.custom-scrollbar::-webkit-scrollbar-thumb:hover{background:#94a3b8} @keyframes shimmer { 100% { transform: translateX(100%); } }`}</style>    </div>
  );
};