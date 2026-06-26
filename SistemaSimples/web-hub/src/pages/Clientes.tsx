import React, { useEffect, useState, useMemo, useRef } from 'react';
import api from '../services/api';
import * as XLSX from 'xlsx';
import { AddCertificateModal } from '../components/AddCertificateModal';
import { 
  UserPlus, FileSpreadsheet, 
  Search, Pencil, ShieldCheck, ShieldAlert, UploadCloud,
  ChevronLeft, ChevronRight, Download, X, Save, Upload, Users, AlertCircle, FileText, Loader2,
  ChevronUp, ChevronDown, ChevronsUpDown, Filter, Clock, Info, PieChart
} from 'lucide-react';

interface Cliente {
  cod: number;
  empresa: string;
  cnpj: string;
  regime_tributario: string;
  grupo: string;
  ativo: boolean;
  rotina: boolean;
  cert_validade: string;
  cert_status: string;
  cert_class: string;
  cert_situacao: string;
}

type SortConfig = { key: keyof Cliente; direction: 'asc' | 'desc'; } | null;

// --- FUNÇÃO INTELIGENTE DE ORDENAÇÃO DE GRUPOS ---
const ordenarGrupos = (a: string, b: string) => {
  if (a === 'Sem Grupo') return 1;
  if (b === 'Sem Grupo') return -1;

  // Separa o número do texto (Ex: "10 SN" -> num=10, text="SN")
  const regex = /^(\d+)?\s*(.*)$/i;
  const matchA = a.match(regex);
  const matchB = b.match(regex);

  const numA = matchA && matchA[1] ? parseInt(matchA[1], 10) : 0;
  const textA = matchA && matchA[2] ? matchA[2].toUpperCase().trim() : a.toUpperCase().trim();

  const numB = matchB && matchB[1] ? parseInt(matchB[1], 10) : 0;
  const textB = matchB && matchB[2] ? matchB[2].toUpperCase().trim() : b.toUpperCase().trim();

  // Define o peso para agrupar as siglas (SN vem antes de LP)
  const getPeso = (txt: string) => {
    if (txt === 'SN') return 1;
    if (txt === 'LP') return 2;
    return 3; // Outros textos
  };

  const pesoA = getPeso(textA);
  const pesoB = getPeso(textB);

  // 1º Regra: Ordena pela Sigla (SN primeiro, depois LP)
  if (pesoA !== pesoB) return pesoA - pesoB;
  
  // 2º Regra: Se a sigla for igual, ordena pelo Número corretamente (2 antes do 10)
  if (numA !== numB) return numA - numB;
  
  // 3º Regra: Fallback para ordem natural alfabética
  return a.localeCompare(b, undefined, { numeric: true });
};
// ------------------------------------------------

export const Clientes: React.FC = () => {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [abaAtiva, setAbaAtiva] = useState<'empresas' | 'certificados'>('empresas');
  const [mostrarInativos, setMostrarInativos] = useState(false);
  const [rotinaFiltro, setRotinaFiltro] = useState('todos'); 
  const [busca, setBusca] = useState('');
  const [loading, setLoading] = useState(true);
  const [paginaAtual, setPaginaAtual] = useState(1);
  const itensPorPagina = 10;
  const [sortConfig, setSortConfig] = useState<SortConfig>(null);
  const [isNovoGrupo, setIsNovoGrupo] = useState(false);

  // --- ESTADOS DOS FILTROS (PADRÃO EXCEL) ---
  const [filtroGrupo, setFiltroGrupo] = useState<string[] | null>(null);
  const [popoverGrupoAberto, setPopoverGrupoAberto] = useState(false);
  const popoverGrupoRef = useRef<HTMLDivElement>(null);

  const [filtroRegime, setFiltroRegime] = useState<string[] | null>(null);
  const [popoverRegimeAberto, setPopoverRegimeAberto] = useState(false);
  const popoverRegimeRef = useRef<HTMLDivElement>(null);

  const [filtroCertStatus, setFiltroCertStatus] = useState<string[] | null>(null);
  const [popoverCertStatusAberto, setPopoverCertStatusAberto] = useState(false);
  const popoverCertStatusRef = useRef<HTMLDivElement>(null);

  const [filtroCertSituacao, setFiltroCertSituacao] = useState<string[] | null>(null);
  const [popoverCertSituacaoAberto, setPopoverCertSituacaoAberto] = useState(false);
  const popoverCertSituacaoRef = useRef<HTMLDivElement>(null);

  const [isModalCertOpen, setIsModalCertOpen] = useState(false);
  const [isModalNovoEditOpen, setIsModalNovoEditOpen] = useState(false);
  const [isModalImportarOpen, setIsModalImportarOpen] = useState(false);
  
  const [isModalGroupStatsOpen, setIsModalGroupStatsOpen] = useState(false);
  const [buscaGrupoStats, setBuscaGrupoStats] = useState(''); 

  const [confirmModal, setConfirmModal] = useState<{ isOpen: boolean; message: string }>({ isOpen: false, message: '' });
  const [modalAlertaAba, setModalAlertaAba] = useState<'vencidos' | 'avencer' | null>(null);
  
  const [arquivoUpload, setArquivoUpload] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  
  const [modoEdicao, setModoEdicao] = useState(false);
  const [formData, setFormData] = useState({
    cod: '', empresa: '', cnpj: '', grupo: '', regime_tributario: 'Simples Nacional', ativo: true, rotina: true
  });

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popoverGrupoRef.current && !popoverGrupoRef.current.contains(event.target as Node)) setPopoverGrupoAberto(false);
      if (popoverRegimeRef.current && !popoverRegimeRef.current.contains(event.target as Node)) setPopoverRegimeAberto(false);
      if (popoverCertStatusRef.current && !popoverCertStatusRef.current.contains(event.target as Node)) setPopoverCertStatusAberto(false);
      if (popoverCertSituacaoRef.current && !popoverCertSituacaoRef.current.contains(event.target as Node)) setPopoverCertSituacaoAberto(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const fetchClientes = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/certificados/listar_completos');
      
      const empresasFormatadas = (data.empresas || []).map((c: any) => {
        let grupoFormatado = c.grupo ? c.grupo.trim() : '';
        if (!grupoFormatado || grupoFormatado === '-' || grupoFormatado.toLowerCase() === 'sem grupo') {
          grupoFormatado = 'Sem Grupo';
        }
        return { ...c, grupo: grupoFormatado };
      });

      setClientes(empresasFormatadas); 
    } catch (err) {
      console.error("Erro ao carregar base Scryta:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchClientes(); }, []);
  useEffect(() => { setPaginaAtual(1); }, [busca, mostrarInativos, abaAtiva, rotinaFiltro, filtroGrupo, filtroRegime, filtroCertStatus, filtroCertSituacao]);

  // ESTATÍSTICAS DE GRUPO COM ORDENAÇÃO INTELIGENTE
  const groupStats = useMemo(() => {
    const stats: Record<string, number> = {};
    let totalAtivos = 0;

    clientes.forEach(c => {
      if (c.ativo) {
        totalAtivos++;
        const g = c.grupo; 
        stats[g] = (stats[g] || 0) + 1;
      }
    });

    // Aplica a nossa função de ordenação customizada aqui!
    const sortedGroups = Object.entries(stats).sort((a, b) => ordenarGrupos(a[0], b[0]));

    return { total: totalAtivos, groups: sortedGroups };
  }, [clientes]);

  const alertas = useMemo(() => {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const limite30Dias = new Date(hoje.getTime() + 30 * 24 * 60 * 60 * 1000);

    const vencidos: Cliente[] = [];
    const aVencer: Cliente[] = [];

    clientes.filter(c => c.ativo).forEach(c => {
      if (c.cert_status === 'Vencido' || c.cert_status === 'Não vinculado' || c.cert_validade === 'Sem certificado' || !c.cert_validade) {
        vencidos.push(c);
      } else if (c.cert_status === 'Válido' && c.cert_validade !== 'Sem certificado') {
        const [dia, mes, ano] = c.cert_validade.split('/');
        const dataCert = new Date(`${ano}-${mes}-${dia}T00:00:00`);
        if (dataCert <= limite30Dias && dataCert >= hoje) {
          aVencer.push(c);
        }
      }
    });

    aVencer.sort((a, b) => {
      const parseDate = (d: string) => {
        const [dia, mes, ano] = d.split('/');
        return new Date(`${ano}-${mes}-${dia}T00:00:00`).getTime();
      };
      return parseDate(a.cert_validade) - parseDate(b.cert_validade);
    });

    vencidos.sort((a, b) => {
      const parseDate = (d: string) => {
        if (!d || d === 'Sem certificado') return 0;
        const [dia, mes, ano] = d.split('/');
        return new Date(`${ano}-${mes}-${dia}T00:00:00`).getTime();
      };
      return parseDate(b.cert_validade) - parseDate(a.cert_validade);
    });

    return { vencidos, aVencer };
  }, [clientes]);

  const handleSort = (key: keyof Cliente) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') direction = 'desc';
    setSortConfig({ key, direction });
  };

  const limparTodosOsFiltros = () => {
    setBusca('');
    setMostrarInativos(false);
    setRotinaFiltro('todos');
    setSortConfig(null);
    setPaginaAtual(1);
    setFiltroGrupo(null);
    setFiltroRegime(null);
    setFiltroCertStatus(null);
    setFiltroCertSituacao(null);
  };

  const abrirModalNovo = () => {
    setIsNovoGrupo(false);
    setModoEdicao(false);
    setFormData({ cod: '', empresa: '', cnpj: '', grupo: '', regime_tributario: 'Simples Nacional', ativo: true, rotina: true });
    setIsModalNovoEditOpen(true);
  };

  const abrirModalEditar = (c: Cliente) => {
    setModoEdicao(true);
    setFormData({ 
      cod: String(c.cod), 
      empresa: c.empresa, 
      cnpj: c.cnpj, 
      grupo: c.grupo === 'Sem Grupo' ? '' : c.grupo, 
      regime_tributario: c.regime_tributario || 'Simples Nacional', 
      ativo: c.ativo,
      rotina: c.rotina !== undefined ? c.rotina : true 
    });
    setIsModalNovoEditOpen(true);
  };

  const handleSalvarCliente = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = { ...formData, cod: parseInt(formData.cod) };
      if (modoEdicao) {
        await api.put(`/cadastro/${payload.cod}`, payload);
      } else {
        await api.post('/cadastro', payload);
      }
      setIsModalNovoEditOpen(false);
      fetchClientes();
      
      setConfirmModal({ isOpen: true, message: `Cliente ${modoEdicao ? 'atualizado' : 'cadastrado'} com sucesso!` });
      
    } catch (err: any) {
      console.error("Erro capturado na API:", err);
      let mensagemErro = "Erro ao salvar cliente.";
      if (err.response && err.response.data) {
         const data = err.response.data;
         if (data.error) {
             mensagemErro = data.error;
         } 
         else if (data.detail) {
            if (Array.isArray(data.detail)) {
               mensagemErro = `Campo inválido: ${data.detail[0].loc.join(' -> ')} (${data.detail[0].msg})`;
            } else {
               mensagemErro = String(data.detail);
            }
         } else {
            mensagemErro = `Erro (Status ${err.response.status}): Ocorreu uma falha no servidor.`;
         }
      } else if (err.request) {
         mensagemErro = "Sem resposta do servidor. A API está rodando?";
      } else {
         mensagemErro = err.message;
      }
      setConfirmModal({ isOpen: true, message: mensagemErro });
    }
  };

  const handleUploadFile = async () => {
    if (!arquivoUpload) {
      setConfirmModal({ isOpen: true, message: "Selecione uma planilha primeiro!" });
      return;
    }
    const fd = new FormData();
    fd.append('file', arquivoUpload);
    setUploading(true);
    try {
      const res = await api.post('/cadastro/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      setConfirmModal({ isOpen: true, message: `Importação concluída!\n${res.data.inseridas} inseridas com sucesso.\n${res.data.erros.length} erros.` });
      setIsModalImportarOpen(false);
      setArquivoUpload(null);
      fetchClientes(); 
    } catch (err: any) {
      console.error(err);
      setConfirmModal({ isOpen: true, message: err.response?.data?.detail || "Erro ao processar a planilha." });
    } finally {
      setUploading(false);
    }
  };

  let clientesFiltrados = clientes.filter(c => {
    const termo = busca.toLowerCase();
    const atendeBusca = (c.empresa || '').toLowerCase().includes(termo) || (c.cnpj || '').includes(termo) || (c.cod || '').toString().includes(termo);
    if (!atendeBusca) return false;
    
    if (abaAtiva === 'empresas') { 
        if (!mostrarInativos && !c.ativo) return false;
        if (rotinaFiltro === 'com_rotina' && c.rotina === false) return false;
        if (rotinaFiltro === 'sem_rotina' && c.rotina !== false) return false;
    }
    
    if (abaAtiva === 'certificados') { 
        if (!c.ativo) return false; 
        if (mostrarInativos) { 
            if (!(c.cert_status === 'Vencido' || c.cert_status === 'Não vinculado' || c.cert_validade === 'Sem certificado' || !c.cert_validade || c.cert_validade.trim() === '')) return false;
        }
    }

    const mGrupo = filtroGrupo === null || filtroGrupo.includes(c.grupo);
    const mRegime = filtroRegime === null || filtroRegime.includes(c.regime_tributario || '-');
    const mCertStatus = filtroCertStatus === null || filtroCertStatus.includes(c.cert_status || '-');
    const mCertSituacao = filtroCertSituacao === null || filtroCertSituacao.includes(c.cert_situacao || '-');

    return mGrupo && mRegime && mCertStatus && mCertSituacao;
  });

  if (sortConfig !== null) {
    clientesFiltrados.sort((a: any, b: any) => {
      let valA = a[sortConfig.key] || '';
      let valB = b[sortConfig.key] || '';
      
      if (sortConfig.key === 'cert_validade' && valA !== 'Sem certificado' && valB !== 'Sem certificado') {
          const parseDate = (d: string) => { const [dia, mes, ano] = d.split('/'); return new Date(`${ano}-${mes}-${dia}`).getTime() || 0; };
          valA = parseDate(valA); valB = parseDate(valB);
      }

      if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
      if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }

  const hasActiveFilters = busca !== '' || mostrarInativos || rotinaFiltro !== 'todos' || 
                           filtroGrupo !== null || filtroRegime !== null || 
                           filtroCertStatus !== null || filtroCertSituacao !== null || sortConfig !== null;

  const exportarParaExcel = () => {
    if (clientesFiltrados.length === 0) return alert("Nenhum dado para exportar.");
    const dadosExcel = clientesFiltrados.map(c => ({
      "Código": c.cod, "Razão Social": c.empresa, "CNPJ": String(c.cnpj),
      "Grupo Econômico": c.grupo, "Regime": c.regime_tributario || '-',
      "Validade Certificado": c.cert_validade, "Status": c.cert_status,
      "Situação": c.cert_situacao || 'Inativo', "Rotina Ativa": c.rotina ? "Sim" : "Não"
    }));
    const worksheet = XLSX.utils.json_to_sheet(dadosExcel);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Clientes_Certificados");
    XLSX.writeFile(workbook, `Relatorio_Scryta_${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  const totalPaginas = Math.max(1, Math.ceil(clientesFiltrados.length / itensPorPagina));
  const indexInicio = (paginaAtual - 1) * itensPorPagina;
  const clientesPaginados = clientesFiltrados.slice(indexInicio, indexInicio + itensPorPagina);
  const inputClass = "w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-semibold outline-none focus:bg-white focus:border-brand-yellow transition-all text-brand-dark";

  // OPÇÕES ÚNICAS (Com a ordenação inteligente aplicada!)
  const valoresGrupoUnicos = Array.from(new Set(clientes.map(c => c.grupo))).sort(ordenarGrupos);
  const valoresRegimeUnicos = Array.from(new Set(clientes.map(c => c.regime_tributario || '-'))).sort();
  const valoresCertStatusUnicos = Array.from(new Set(clientes.map(c => c.cert_status || '-'))).sort();
  const valoresCertSituacaoUnicos = Array.from(new Set(clientes.map(c => c.cert_situacao || '-'))).sort();

  const renderTh = (label: string, sortKey: keyof Cliente, align: 'left'|'center'|'right' = 'left') => {
    const isActiveSort = sortConfig !== null && sortConfig.key === sortKey;
    return (
      <th className={`p-3 align-middle relative select-none bg-brand-panel group ${align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : 'text-left'}`}>
        <div className={`flex items-center gap-1.5 ${align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start'}`}>
          <span className={`font-black uppercase text-[10px] tracking-widest cursor-pointer hover:text-brand-yellow transition-colors ${isActiveSort ? 'text-brand-dark' : 'text-gray-500'}`} onClick={() => handleSort(sortKey)}>
            {label}
          </span>
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
      sortKey: keyof Cliente, 
      filterValues: string[] | null,
      setFilterValues: React.Dispatch<React.SetStateAction<string[] | null>>,
      isPopoverOpen: boolean,
      setPopoverOpen: React.Dispatch<React.SetStateAction<boolean>>,
      popoverRef: React.RefObject<HTMLDivElement | null>,
      uniqueOptions: string[],
      align: 'left' | 'center' = 'left',
      onInfoClick?: () => void
  ) => {
      const isActive = sortConfig?.key === sortKey;
      return (
        <th className={`p-3 relative bg-brand-panel ${align === 'center' ? 'text-center' : 'text-left'}`}>
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

            <div ref={popoverRef} className="relative ml-1 flex items-center">
              <button 
                onClick={() => setPopoverOpen(!isPopoverOpen)}
                className={`p-1 rounded transition-colors ${filterValues !== null ? 'bg-blue-50 text-brand-yellow' : 'text-gray-300 hover:text-gray-500 hover:bg-gray-100'}`}
              >
                <Filter size={12} className={filterValues !== null ? 'fill-brand-yellow/20' : ''} />
              </button>

              {onInfoClick && (
                <button 
                  onClick={onInfoClick}
                  className="p-1.5 ml-1 rounded transition-colors text-brand-yellow hover:text-brand-yellow hover:bg-blue-50"
                  title="Ver Estatísticas dos Grupos"
                >
                  <Info size={14} />
                </button>
              )}

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
                          <span className="truncate">{val}</span>
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

  return (
    <div className="space-y-6 font-['Poppins'] pb-10">
      
      <div className="mb-8 flex items-center justify-between px-2">
        <div className="flex items-center gap-5">
          <div className="w-14 h-14 bg-brand-yellow/10 rounded-2xl flex items-center justify-center shrink-0 text-brand-yellow">
            <Users size={28} />
          </div>
          <div className="space-y-0.5">
            <h1 className="text-2xl font-bold text-brand-dark tracking-tight">Cadastro de <span className="text-brand-yellow font-medium">Clientes</span></h1>
            <p className="text-[13px] text-gray-500 font-medium">Gerencie as empresas e monitore a validade dos certificados digitais.</p>
          </div>
        </div>

        <div className="flex bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-all">
           <button onClick={() => setModalAlertaAba('vencidos')} className="flex items-center gap-2 px-4 py-2.5 hover:bg-red-50 transition-colors group">
              <ShieldAlert size={16} className="text-red-500 group-hover:scale-110 transition-transform" />
              <span className="text-[10px] font-black uppercase tracking-widest text-red-600">
                {alertas.vencidos.length} <span className="hidden sm:inline">Vencidos</span>
              </span>
           </button>
           <div className="w-px bg-gray-200 my-2"></div>
           <button onClick={() => setModalAlertaAba('avencer')} className="flex items-center gap-2 px-4 py-2.5 hover:bg-yellow-50 transition-colors group">
              <Clock size={16} className="text-yellow-500 group-hover:scale-110 transition-transform" />
              <span className="text-[10px] font-black uppercase tracking-widest text-yellow-600">
                {alertas.aVencer.length} <span className="hidden sm:inline">A Vencer (30d)</span>
              </span>
           </button>
        </div>
      </div>

      <div className="flex flex-wrap lg:flex-nowrap gap-4 items-center justify-between bg-white p-5 rounded-xl shadow-sm border border-gray-100">
        <div className="flex flex-wrap gap-3 shrink-0">
          {abaAtiva === 'empresas' ? (
            <>
              <button onClick={abrirModalNovo} className="flex items-center gap-2 bg-brand-dark text-white px-5 py-2.5 rounded-lg font-black text-[10px] uppercase tracking-widest hover:text-brand-yellow transition-all shadow-sm">
                <UserPlus size={16} /> Novo Cliente
              </button>
              <button onClick={() => { setIsModalImportarOpen(true); setArquivoUpload(null); }} className="flex items-center gap-2 bg-gray-50 text-brand-dark border border-gray-200 px-5 py-2.5 rounded-lg font-black text-[10px] uppercase tracking-widest hover:bg-white transition-all">
                <FileSpreadsheet size={16} /> Cadastro em Lote
              </button>
              <button onClick={exportarParaExcel} className="flex items-center gap-2 bg-gray-50 text-brand-dark border border-gray-200 px-5 py-2.5 rounded-lg font-black text-[10px] uppercase tracking-widest hover:bg-white transition-all">
                <Download size={16} /> Exportar Dados
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setIsModalCertOpen(true)} className="flex items-center gap-2 bg-brand-dark text-white px-5 py-2.5 rounded-lg font-black text-[10px] uppercase tracking-widest hover:text-brand-yellow transition-all shadow-md">
                <UploadCloud size={16} /> Adicionar Certificado
              </button>
            </>
          )}
        </div>

        <div className="flex items-center gap-3 flex-nowrap overflow-x-auto custom-scrollbar w-full lg:w-auto lg:justify-end pb-1 lg:pb-0">
          <label className="flex items-center gap-2 text-[11px] uppercase font-black tracking-tighter text-gray-500 cursor-pointer hover:text-brand-dark transition-colors whitespace-nowrap shrink-0">
            <input type="checkbox" checked={mostrarInativos} onChange={e => setMostrarInativos(e.target.checked)} style={{ accentColor: '#fdb913' }} className="w-4 h-4 rounded border-gray-300 cursor-pointer" />
            {abaAtiva === 'empresas' ? 'Mostrar inativos' : 'Ver apenas alertas'}
          </label>

          {abaAtiva === 'empresas' && (
            <div className="relative flex items-center bg-gray-50 rounded-lg px-2 py-2 border border-transparent focus-within:bg-white transition-all shrink-0">
              <Filter size={14} className="text-brand-yellow mr-1" />
              <select value={rotinaFiltro} onChange={(e) => setRotinaFiltro(e.target.value)} className="bg-transparent text-[10px] font-black uppercase outline-none cursor-pointer appearance-none pr-5 text-brand-dark">
                <option value="todos">Rotina: Todas</option>
                <option value="com_rotina">Com Rotina</option>
                <option value="sem_rotina">Sem Rotina</option>
              </select>
              <ChevronDown size={12} className="absolute right-2 text-gray-500 pointer-events-none" />
            </div>
          )}

          <div className="relative shrink-0">
            <Search className="absolute left-3.5 top-2.5 text-gray-500" size={16} />
            <input type="text" placeholder="Buscar (Cód, Nome ou CNPJ)..." value={busca} onChange={e => setBusca(e.target.value)} className="pl-10 pr-4 py-2.5 bg-gray-50 border border-transparent rounded-lg text-xs font-bold outline-none focus:bg-white focus:border-gray-200 w-48 sm:w-64 text-brand-dark transition-all" />
          </div>

          {hasActiveFilters && (
            <button onClick={limparTodosOsFiltros} className="shrink-0 text-[9px] uppercase font-bold text-red-400 hover:text-red-600 px-2 transition-colors whitespace-nowrap">
              Limpar
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-8 border-b border-gray-200 px-4">
        <button onClick={() => setAbaAtiva('empresas')} className={`pb-3 text-xs font-black uppercase tracking-widest transition-all border-b-2 ${abaAtiva === 'empresas' ? 'border-brand-yellow text-brand-dark' : 'border-transparent text-gray-500 hover:text-gray-600'}`}>Empresas</button>
        <button onClick={() => setAbaAtiva('certificados')} className={`pb-3 text-xs font-black uppercase tracking-widest transition-all border-b-2 ${abaAtiva === 'certificados' ? 'border-brand-yellow text-brand-dark' : 'border-transparent text-gray-500 hover:text-gray-600'}`}>Certificados</button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden relative z-0">
        <div className="overflow-x-auto custom-scrollbar pb-6 min-h-87.5">
          <table className="w-full text-left text-sm">
            <thead className="bg-brand-panel border-b border-gray-200">
              <tr>
                {renderTh('Cliente', 'empresa', 'left')}
                {abaAtiva === 'empresas' ? (
                  <>
                    {renderExcelTh('Grupo', 'grupo', filtroGrupo, setFiltroGrupo, popoverGrupoAberto, setPopoverGrupoAberto, popoverGrupoRef, valoresGrupoUnicos, 'left', () => setIsModalGroupStatsOpen(true))}
                    {renderExcelTh('Regime', 'regime_tributario', filtroRegime, setFiltroRegime, popoverRegimeAberto, setPopoverRegimeAberto, popoverRegimeRef, valoresRegimeUnicos, 'left')}
                    <th className="p-3 text-center bg-brand-panel font-black uppercase text-[10px] text-gray-500 sticky right-0 shadow-[-4px_0_10px_rgba(0,0,0,0.02)] z-10 w-20 border-l border-gray-50 border-b">Ação</th>
                  </>
                ) : (
                  <>
                    {renderTh('Validade', 'cert_validade', 'center')}
                    {renderExcelTh('Status', 'cert_status', filtroCertStatus, setFiltroCertStatus, popoverCertStatusAberto, setPopoverCertStatusAberto, popoverCertStatusRef, valoresCertStatusUnicos, 'center')}
                    {renderExcelTh('Situação', 'cert_situacao', filtroCertSituacao, setFiltroCertSituacao, popoverCertSituacaoAberto, setPopoverCertSituacaoAberto, popoverCertSituacaoRef, valoresCertSituacaoUnicos, 'center')}
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                <tr><td colSpan={4} className="p-12 text-center text-gray-300 italic animate-pulse font-bold">Consultando base...</td></tr>
              ) : clientesPaginados.length === 0 ? (
                <tr><td colSpan={4} className="p-12 text-center text-gray-500 font-bold">Nenhum registro encontrado.</td></tr>
              ) : clientesPaginados.map(c => (
                <tr key={c.cod} className={`hover:bg-gray-50/80 transition-colors group ${!c.ativo ? 'opacity-50' : ''}`}>
                  
                  <td className="p-3 align-top max-w-70">
                    <div className="flex flex-col gap-0.5">
                      <div className="font-bold text-brand-dark truncate flex flex-wrap items-center gap-2" title={c.empresa}>
                        <span className={!c.ativo ? 'line-through text-gray-500' : ''}>
                          <span className={`${!c.ativo ? 'text-gray-500' : 'text-brand-yellow'} mr-1.5 font-black`}>{c.cod}</span>
                          {c.empresa}
                        </span>
                        
                        {!c.ativo && (
                           <span className="bg-red-50 text-red-500 border border-red-100 px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-tight">
                             Inativo
                           </span>
                        )}

                        {abaAtiva === 'empresas' && c.rotina === false && (
                           <span className="flex items-center gap-1 bg-yellow-50 border border-yellow-100 text-yellow-600 px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-tight" title="Não aparece em Faturamento e PGDAS">
                             <AlertCircle size={8} /> S/ Rotina
                           </span>
                        )}
                      </div>
                      <div className="text-[12px] font-bold text-gray-500 font-mono tracking-tighter">{c.cnpj}</div>
                    </div>
                  </td>

                  {abaAtiva === 'empresas' ? (
                    <>
                      <td className="p-3 align-top">
                        <span className={`font-medium text-sm ${c.grupo === 'Sem Grupo' ? 'text-gray-500 italic' : 'text-gray-600'}`}>
                          {c.grupo}
                        </span>
                      </td>
                      <td className="p-3 align-top">
                        <span className="font-medium text-gray-600 text-sm">{c.regime_tributario || '-'}</span>
                      </td>
                      <td className="p-3 align-middle text-center sticky right-0 bg-white group-hover:bg-gray-50/80 shadow-[-4px_0_10px_rgba(0,0,0,0.02)] transition-colors border-l border-transparent z-10 w-20">
                        <button onClick={() => abrirModalEditar(c)} className="p-2 text-gray-500 hover:text-brand-yellow hover:bg-gray-100 rounded-lg transition-all" title="Editar Cliente">
                          <Pencil size={18} className="mx-auto" />
                        </button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="p-3 align-top text-center">
                        <span className={`font-bold text-xs ${c.cert_validade === 'Sem certificado' ? 'text-gray-300 italic' : 'text-brand-dark'}`}>
                          {c.cert_validade}
                        </span>
                      </td>
                      <td className="p-3 align-top text-center">
                        <span className={`px-2 py-1 inline-block rounded-md text-[9px] font-black uppercase border ${
                          c.cert_status === 'Válido' ? 'bg-green-50 text-green-600 border-green-100' : 
                          c.cert_status === 'Vencido' ? 'bg-red-50 text-red-600 border-red-100' : 
                          'bg-gray-50 text-gray-500 border-gray-200'
                        }`}>
                          {c.cert_status}
                        </span>
                      </td>
                      <td className="p-3 align-top text-center">
                        {c.cert_situacao === 'Ativo' ? (
                          <span className="text-green-600 flex items-center justify-center gap-1.5 font-black text-[9px] uppercase mt-1">
                            <ShieldCheck size={12}/> Ativo
                          </span>
                        ) : (
                          <span className="text-red-400 flex items-center justify-center gap-1.5 font-black text-[9px] uppercase mt-1">
                            <ShieldAlert size={12}/> {c.cert_situacao || 'Inativo'}
                          </span>
                        )}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        
        {!loading && clientesFiltrados.length > 0 && (
          <div className="bg-white border-t border-gray-100 p-4 flex items-center justify-between text-[10px] font-black text-gray-500 uppercase tracking-widest rounded-b-xl z-20 shadow-[0_-10px_20px_rgba(0,0,0,0.02)]">
            <div>Mostrando <span className="text-brand-dark">{indexInicio + 1} - {Math.min(indexInicio + itensPorPagina, clientesFiltrados.length)}</span> de {clientesFiltrados.length}</div>
            <div className="flex items-center gap-3">
              <button onClick={() => setPaginaAtual(prev => Math.max(prev - 1, 1))} disabled={paginaAtual === 1} className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-20 transition-all text-brand-dark"><ChevronLeft size={16} /></button>
              <span className="text-brand-dark font-black">Pág {paginaAtual} / {totalPaginas}</span>
              <button onClick={() => setPaginaAtual(prev => Math.min(prev + 1, totalPaginas))} disabled={paginaAtual === totalPaginas} className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-20 transition-all text-brand-dark"><ChevronRight size={16} /></button>
            </div>
          </div>
        )}
      </div>

      {modalAlertaAba !== null && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[25px] shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col border border-gray-100 max-h-[85vh]">
            <div className="bg-brand-dark px-8 py-5 flex items-center justify-between border-b-4 border-brand-yellow shrink-0">
              <h2 className="text-white font-bold uppercase tracking-widest text-xs flex items-center gap-2">
                <ShieldAlert size={18} className="text-brand-yellow" /> Relatório de Alertas (Ativos)
              </h2>
              <button onClick={() => setModalAlertaAba(null)} className="text-gray-500 hover:text-white transition-all"><X size={22} /></button>
            </div>
            
            <div className="flex border-b border-gray-200 bg-gray-50 shrink-0">
              <button 
                onClick={() => setModalAlertaAba('vencidos')} 
                className={`flex-1 py-4 flex items-center justify-center gap-2 text-xs font-black uppercase tracking-widest transition-all border-b-2 
                  ${modalAlertaAba === 'vencidos' ? 'border-red-500 text-red-600 bg-white' : 'border-transparent text-gray-500 hover:bg-gray-100'}`}
              >
                <ShieldAlert size={16} /> Vencidos ou Pendentes ({alertas.vencidos.length})
              </button>
              <button 
                onClick={() => setModalAlertaAba('avencer')} 
                className={`flex-1 py-4 flex items-center justify-center gap-2 text-xs font-black uppercase tracking-widest transition-all border-b-2 
                  ${modalAlertaAba === 'avencer' ? 'border-yellow-500 text-yellow-600 bg-white' : 'border-transparent text-gray-500 hover:bg-gray-100'}`}
              >
                <Clock size={16} /> A Vencer (30d) ({alertas.aVencer.length})
              </button>
            </div>

            <div className="p-6 overflow-y-auto custom-scrollbar flex flex-col gap-6 bg-gray-50/50">
              
              {modalAlertaAba === 'vencidos' && (
                <div>
                   {alertas.vencidos.length === 0 ? (
                      <div className="bg-white border border-gray-100 rounded-xl p-8 flex flex-col items-center justify-center gap-2">
                         <ShieldCheck size={32} className="text-green-500" />
                         <span className="text-sm font-bold text-gray-500">Nenhum certificado vencido! 🎉</span>
                      </div>
                   ) : (
                      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
                         {alertas.vencidos.map((c, i) => (
                            <div key={i} className="flex items-center justify-between p-3 border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors">
                               <div>
                                  <div className="text-xs font-bold text-brand-dark"><span className="text-gray-500 mr-1">{c.cod}</span> {c.empresa}</div>
                                  <div className="text-[12px] text-gray-500 font-mono mt-0.5">{c.cnpj}</div>
                               </div>
                               <div className="flex flex-col items-end">
                                 <span className="px-2 py-1 rounded text-[9px] font-black uppercase bg-red-50 text-red-600 border border-red-100">
                                    {c.cert_validade === 'Sem certificado' ? 'Sem Certificado' : c.cert_status}
                                 </span>
                                 {c.cert_validade !== 'Sem certificado' && (
                                   <span className="text-[9px] uppercase text-gray-500 font-bold mt-1">Expirou: {c.cert_validade}</span>
                                 )}
                               </div>
                            </div>
                         ))}
                      </div>
                   )}
                </div>
              )}

              {modalAlertaAba === 'avencer' && (
                <div>
                   {alertas.aVencer.length === 0 ? (
                      <div className="bg-white border border-gray-100 rounded-xl p-8 flex flex-col items-center justify-center gap-2">
                        <ShieldCheck size={32} className="text-green-500" />
                        <span className="text-sm font-bold text-gray-500">Nenhum certificado a vencer em breve.</span>
                      </div>
                   ) : (
                      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
                         {alertas.aVencer.map((c, i) => (
                            <div key={i} className="flex items-center justify-between p-3 border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors">
                               <div>
                                  <div className="text-xs font-bold text-brand-dark"><span className="text-gray-500 mr-1">{c.cod}</span> {c.empresa}</div>
                                  <div className="text-[12px] text-gray-500 font-mono mt-0.5">{c.cnpj}</div>
                               </div>
                               <div className="flex flex-col items-end">
                                  <span className="px-2 py-1 rounded text-[11px] font-black uppercase bg-yellow-50 text-yellow-600 border border-yellow-100">{c.cert_validade}</span>
                                  <span className="text-[8px] uppercase text-gray-500 font-bold mt-1">Expira em breve</span>
                               </div>
                            </div>
                         ))}
                      </div>
                   )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL DE ESTATÍSTICAS DE GRUPO --- */}
      {isModalGroupStatsOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-70 p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-[25px] shadow-2xl w-full max-w-sm overflow-hidden flex flex-col border border-gray-100">
            <div className="bg-brand-dark px-6 py-4 flex items-center justify-between border-b-4 border-brand-yellow">
              <div className="flex items-center gap-2 text-white">
                <PieChart size={20} className="text-brand-yellow" />
                <h2 className="font-bold text-lg tracking-tight">Estatísticas</h2>
              </div>
              <button onClick={() => { setIsModalGroupStatsOpen(false); setBuscaGrupoStats(''); }} className="text-gray-500 hover:text-white transition-colors"><X size={22} /></button>
            </div>
            
            <div className="p-6 flex flex-col items-center">
              <div className="text-center mb-6">
                <p className="text-xs font-black uppercase tracking-widest text-gray-500 mb-1">Total de Clientes Ativos</p>
                <p className="text-4xl font-black text-brand-yellow">{groupStats.total}</p>
              </div>

              <div className="w-full bg-gray-50 rounded-xl border border-gray-100 p-4 flex flex-col">
                <div className="flex items-center justify-between mb-3 border-b border-gray-200 pb-3 gap-2">
                  <h3 className="text-[10px] font-black uppercase text-gray-500 tracking-widest whitespace-nowrap">Distribuição</h3>
                  <div className="relative w-full max-w-32.5">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" size={12} />
                    <input 
                      type="text" 
                      placeholder="Buscar grupo..." 
                      value={buscaGrupoStats}
                      onChange={(e) => setBuscaGrupoStats(e.target.value)}
                      className="w-full pl-6 pr-2 py-1.5 bg-white border border-gray-200 rounded-md text-[10px] font-bold outline-none focus:border-brand-yellow transition-all text-brand-dark"
                    />
                  </div>
                </div>

                <div className="space-y-2 max-h-56 overflow-y-auto custom-scrollbar pr-1">
                  {groupStats.groups
                    .filter(([nome]) => nome.toLowerCase().includes(buscaGrupoStats.toLowerCase()))
                    .map(([nome, qtd]) => (
                      <div key={nome} className="flex justify-between items-center text-sm">
                        <span className={`font-bold ${nome === 'Sem Grupo' ? 'text-gray-500 italic' : 'text-brand-dark'}`}>
                          {nome}
                        </span>
                        <span className="bg-white border border-gray-200 px-2 py-0.5 rounded-md text-xs font-black text-brand-yellow shadow-sm">
                          {qtd}
                        </span>
                      </div>
                  ))}
                  
                  {groupStats.groups.filter(([nome]) => nome.toLowerCase().includes(buscaGrupoStats.toLowerCase())).length === 0 && (
                    <div className="text-center text-xs text-gray-500 font-bold py-4">Nenhum grupo encontrado.</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {isModalNovoEditOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[25px] shadow-2xl w-full max-w-lg overflow-hidden flex flex-col border border-gray-100">
            <div className="bg-brand-dark px-8 py-5 flex items-center justify-between border-b-4 border-brand-yellow">
              <h2 className="text-white font-bold uppercase tracking-widest text-xs">
                {modoEdicao ? 'Editar Empresa' : 'Novo Cliente Scryta'}
              </h2>
              <button onClick={() => setIsModalNovoEditOpen(false)} className="text-gray-500 hover:text-white transition-all"><X size={22} /></button>
            </div>
            <form onSubmit={handleSalvarCliente} className="p-8 space-y-5">
              <div className="grid grid-cols-4 gap-4">
                <div className="col-span-1 space-y-1">
                  <label className="text-[10px] uppercase font-black text-gray-500 ml-1">Cód</label>
                  <input type="text" value={formData.cod} onChange={e => setFormData({...formData, cod: e.target.value})} className={inputClass} placeholder="01" required disabled={modoEdicao} />
                </div>
                <div className="col-span-3 space-y-1">
                  <label className="text-[10px] uppercase font-black text-gray-500 ml-1">Razão Social</label>
                  <input type="text" value={formData.empresa} onChange={e => setFormData({...formData, empresa: e.target.value})} className={inputClass} placeholder="Nome da Empresa" required />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[12px] uppercase font-black text-gray-500 ml-1">CNPJ</label>
                  <input type="text" value={formData.cnpj} onChange={e => setFormData({...formData, cnpj: e.target.value})} className={inputClass} placeholder="00.000.000/0000-00" required />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-black text-gray-500 ml-1">Regime Tributário</label>
                  <select value={formData.regime_tributario} onChange={e => setFormData({...formData, regime_tributario: e.target.value})} className={inputClass}>
                    <option value="Simples Nacional">Simples Nacional</option>
                    <option value="Lucro Presumido">Lucro Presumido</option>
                    <option value="Lucro Real">Lucro Real</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase font-black text-gray-500 ml-1">Grupo Econômico</label>
                <div className="relative">
                  <select 
                    value={isNovoGrupo ? 'novo_grupo' : formData.grupo} 
                    onChange={e => {
                      if (e.target.value === 'novo_grupo') {
                        setIsNovoGrupo(true);
                        setFormData({...formData, grupo: ''}); 
                      } else {
                        setIsNovoGrupo(false);
                        setFormData({...formData, grupo: e.target.value});
                      }
                    }} 
                    className={`${inputClass} appearance-none pr-10`}
                  >
                    <option value="">Sem Grupo / Nenhum</option>
                    {Array.from(new Set(clientes.map(c => c.grupo))).sort(ordenarGrupos).filter(g => g !== 'Sem Grupo').map(grupo => (
                      <option key={grupo} value={grupo}>{grupo}</option>
                    ))}
                    <option value="novo_grupo">+ Adicionar Novo Grupo...</option>
                  </select>
                  <ChevronDown size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                </div>
                
                {isNovoGrupo && (
                  <input 
                    type="text" 
                    value={formData.grupo}
                    placeholder="Digite o nome do novo grupo..."
                    onChange={e => setFormData({...formData, grupo: e.target.value})} 
                    className={`${inputClass} mt-2 border-dashed border-brand-yellow/30 bg-blue-50/30`}
                    autoFocus
                  />
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-black text-gray-500 ml-1">Status no Sistema</label>
                  <div className="flex items-center h-11.5 px-4 bg-gray-50 border border-gray-200 rounded-xl cursor-pointer hover:bg-gray-100 transition-colors" onClick={() => setFormData({...formData, ativo: !formData.ativo})}>
                    <label className="flex items-center justify-between w-full cursor-pointer">
                        <span className={`text-[11px] font-black uppercase tracking-tighter ${formData.ativo ? 'text-green-600' : 'text-gray-500'}`}>
                          {formData.ativo ? 'Ativo' : 'Inativo'}
                        </span>
                        <input type="checkbox" checked={formData.ativo} readOnly style={{ accentColor: '#10b981' }} className="w-4 h-4 cursor-pointer" />
                    </label>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-black text-gray-500 ml-1" title="Exibir nas telas de faturamento e PGDAS?">Incluir na Apuração?</label>
                  <div className="flex items-center h-11.5 px-4 bg-gray-50 border border-gray-200 rounded-xl cursor-pointer hover:bg-gray-100 transition-colors" onClick={() => setFormData({...formData, rotina: !formData.rotina})}>
                    <label className="flex items-center justify-between w-full cursor-pointer">
                        <span className={`text-[11px] font-black uppercase tracking-tighter ${formData.rotina ? 'text-brand-yellow' : 'text-gray-500'}`}>
                          {formData.rotina ? 'Sim' : 'Não'}
                        </span>
                        <input type="checkbox" checked={formData.rotina} readOnly style={{ accentColor: '#fdb913' }} className="w-4 h-4 cursor-pointer" />
                    </label>
                  </div>
                </div>
              </div>

              <div className="pt-4 flex gap-4">
                <button type="button" onClick={() => setIsModalNovoEditOpen(false)} className="flex-1 px-6 py-4 bg-gray-50 text-gray-500 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-gray-100 transition-all">Cancelar</button>
                <button type="submit" className="flex-1 px-6 py-4 bg-brand-dark text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:text-brand-yellow transition-all shadow-xl flex items-center justify-center gap-2">
                  <Save size={16}/> Salvar Cadastro
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isModalImportarOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[25px] shadow-2xl w-full max-w-md overflow-hidden flex flex-col border border-gray-100">
            <div className="bg-brand-dark px-8 py-5 flex items-center justify-between border-b-4 border-brand-yellow">
              <h2 className="text-white font-bold uppercase text-xs tracking-widest">Importação em Lote</h2>
              <button onClick={() => setIsModalImportarOpen(false)} className="text-gray-500 hover:text-white transition-all"><X size={22} /></button>
            </div>
            
            <div className="p-8 space-y-6 text-center">
               <div className="flex justify-between items-center bg-brand-yellow/10 p-4 rounded-xl border border-brand-yellow/20 mb-2">
                  <div className="text-left flex-1 pr-2">
                    <h3 className="text-xs font-black text-brand-dark uppercase tracking-tight">Precisa do modelo?</h3>
                    <p className="text-[9px] text-gray-500 mt-1 font-medium">Baixe a planilha com as regras e opções bloqueadas.</p>
                  </div>
                  <a 
                    href="/padrao_cadastro_cliente.xlsx" 
                    download="padrao_cadastro_cliente.xlsx"
                    className="bg-white text-brand-dark px-4 py-2.5 rounded-lg font-black text-[9px] border border-brand-yellow/30 uppercase tracking-widest hover:bg-brand-yellow transition-all flex items-center gap-2 shadow-sm shrink-0 cursor-pointer"
                  >
                    <Download size={14} /> Padrão
                  </a>
               </div>

               <label className="border-2 border-dashed border-gray-200 rounded-[20px] p-10 hover:border-brand-yellow/60 transition-all cursor-pointer bg-gray-50 group block relative">
                  <input 
                    type="file" 
                    accept=".xlsx, .xls, .csv" 
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    onChange={(e) => setArquivoUpload(e.target.files ? e.target.files[0] : null)}
                  />
                  {arquivoUpload ? (
                    <div className="flex flex-col items-center">
                      <FileText size={40} className="text-brand-yellow mb-3" />
                      <p className="text-xs font-black text-brand-dark">{arquivoUpload.name}</p>
                      <p className="text-[10px] text-gray-500 mt-1">Clique para trocar</p>
                    </div>
                  ) : (
                    <>
                      <Upload size={40} className="mx-auto text-gray-300 group-hover:text-brand-yellow mb-3 transition-colors" />
                      <p className="text-xs font-bold text-gray-500 uppercase tracking-tighter leading-tight">
                        Arraste ou clique para selecionar<br/>o arquivo .xlsx preenchido
                      </p>
                    </>
                  )}
               </label>
               
               <button 
                 onClick={handleUploadFile} 
                 disabled={!arquivoUpload || uploading}
                 className={`w-full px-6 py-4 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all shadow-xl flex justify-center items-center gap-2
                    ${arquivoUpload && !uploading ? 'bg-brand-dark hover:text-brand-yellow cursor-pointer' : 'bg-gray-300 cursor-not-allowed'}`}
               >
                 {uploading ? <Loader2 size={16} className="animate-spin"/> : 'Processar Arquivo'}
               </button>
            </div>
          </div>
        </div>
      )}

      {confirmModal.isOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-70 p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-[25px] shadow-2xl w-full max-w-sm overflow-hidden flex flex-col border border-gray-100">
            <div className="bg-brand-dark px-6 py-4 flex items-center justify-between border-b-4 border-brand-yellow">
              <div className="flex items-center gap-2 text-white">
                <AlertCircle size={20} className="text-brand-yellow" />
                <h2 className="font-bold text-lg tracking-tight">Aviso</h2>
              </div>
              <button onClick={() => setConfirmModal({ isOpen: false, message: '' })} className="text-gray-500 hover:text-white transition-colors"><X size={22} /></button>
            </div>
            <div className="p-8 text-center flex flex-col items-center">
              <p className="text-brand-dark text-sm font-bold leading-relaxed mb-6">{confirmModal.message}</p>
              <button onClick={() => setConfirmModal({ isOpen: false, message: '' })} className="w-full px-4 py-3 bg-brand-dark text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:text-brand-yellow transition-all shadow-md">
                Entendi
              </button>
            </div>
          </div>
        </div>
      )}

      <AddCertificateModal 
        isOpen={isModalCertOpen} 
        onClose={() => setIsModalCertOpen(false)} 
        onSuccess={fetchClientes} 
        clientes={clientes.filter(c => c.ativo).map(c => ({ cod: c.cod, empresa: c.empresa, cnpj: c.cnpj }))} 
      /> 
      
      <style>{`.custom-scrollbar::-webkit-scrollbar{width:4px}.custom-scrollbar::-webkit-scrollbar-track{background:#f1f1f1;border-radius:4px}.custom-scrollbar::-webkit-scrollbar-thumb{background:#d1d5db;border-radius:4px}`}</style>
    </div>
  );
};