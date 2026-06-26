import React, { useEffect, useState, useCallback, useRef } from 'react';
import api from '../services/api';
import {
  RefreshCw, ChevronLeft, ChevronRight,
  Search, Calendar, Loader2, Download, Percent, AlertTriangle, CheckCircle2, TrendingDown, Users, FileText, Info
} from 'lucide-react';
import * as XLSX from 'xlsx';

// --- IMPORTAÇÕES PARA DATA EM PORTUGUÊS ---
import DatePicker, { registerLocale } from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { ptBR } from "date-fns/locale"; 

registerLocale("pt-BR", ptBR);
// ------------------------------------------

interface EmpresaFatorR {
  cod: number;
  cnpj: string;
  empresa: string;
  grupo: string;
  fator_r_percentual: number;
  anexo?: number;
  descricao_tabela?: string;
  ativo?: boolean; // Adicionado para suportar a visualização de inativos (se a API retornar)
}

type FilterType = 'all' | 'risco' | 'atencao' | 'seguro';

const InfoTooltip = ({ anexo, descricao }: { anexo?: number, descricao?: string }) => {
  const [isOpen, setIsOpen] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setIsOpen(true);
  };

  const handleMouseLeave = () => {
    timeoutRef.current = setTimeout(() => setIsOpen(false), 200);
  };

  if (!anexo && !descricao) return null;

  return (
    <div className="relative inline-flex items-center" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
      <button 
        className="flex items-center gap-1.5 px-2 py-1 rounded border border-gray-200 bg-white text-gray-500 hover:text-brand-yellow hover:border-brand-yellow/30 hover:bg-brand-yellow/5 transition-all text-[10px] font-black tracking-tight"
        onClick={() => setIsOpen(!isOpen)}
        title="Ver detalhes do enquadramento"
      >
        <FileText size={12} />
        {anexo ? `Anexo ${anexo}` : 'Detalhes'}
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-2 w-72 bg-brand-dark text-white p-3 rounded-xl shadow-xl z-50 text-left border border-gray-600 animate-in fade-in zoom-in duration-200">
           <div className="flex items-start gap-2">
             <Info size={14} className="text-brand-yellow shrink-0 mt-0.5" />
             <div className="flex flex-col gap-1">
               <span className="text-[11px] font-black text-white uppercase tracking-widest border-b border-gray-600 pb-1">
                 Anexo {anexo || 'Não informado'}
               </span>
               <span className="text-[10px] text-gray-300 leading-relaxed font-medium">
                 {descricao || 'Nenhuma descrição de tabela encontrada no sistema Domínio para esta apuração.'}
               </span>
             </div>
           </div>
           <div className="absolute -top-1.5 left-5 w-3 h-3 bg-brand-dark border-t border-l border-gray-600 rotate-45"></div>
        </div>
      )}
    </div>
  );
};

export const FatorR: React.FC = () => {
  const [faturas, setFaturas] = useState<EmpresaFatorR[]>([]);
  const [busca, setBusca] = useState('');
  const [loading, setLoading] = useState(false);
  
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');

  const [mesano, setMesano] = useState(() => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });

  const [paginaAtual, setPaginaAtual] = useState(1);
  const itensPorPagina = 10;

  const formatPercentDisplay = (v: number) => {
    const valorReal = v / 100;
    return valorReal.toLocaleString('pt-BR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 1
    }) + '%';
  };

  const formatCNPJ = (cnpjRaw: any) => {
    if (!cnpjRaw) return '—';
    const num = String(cnpjRaw).replace(/\D/g, '');
    if (num.length === 14) {
      return num.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
    }
    return String(cnpjRaw) || '—';
  };

  const fetchData = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const mesFormatado = mesano.replace('-', '');
      const response = await api.get(`/automacao/fator-r?mesano=${mesFormatado}`);
      setFaturas(response.data.data || []);
    } catch (err) {
      console.error("Erro ao buscar dados do Fator R:", err);
      setFaturas([]);
    } finally {
      setLoading(false);
    }
  }, [mesano]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => { 
    setPaginaAtual(1); 
  }, [busca, mesano, activeFilter]);

  const shiftMonth = (delta: number) => {
    if (!mesano) return;
    const [y, m] = mesano.split('-').map(Number);
    const newDate = new Date(y, m - 1 + delta, 1);
    setMesano(`${newDate.getFullYear()}-${String(newDate.getMonth() + 1).padStart(2, "0")}`);
  };

  const limparFiltros = () => {
    setBusca('');
    setActiveFilter('all');
    setPaginaAtual(1);
  };

  const toggleFilter = (filter: FilterType) => {
    setActiveFilter(prev => prev === filter ? 'all' : filter);
  };

  let faturasFiltradas = faturas.filter(f =>
    (f.empresa || '').toLowerCase().includes(busca.toLowerCase()) || 
    String(f.cod).includes(busca) ||
    (f.cnpj || '').includes(busca) ||
    (f.grupo || '').toLowerCase().includes(busca.toLowerCase()) ||
    (f.descricao_tabela || '').toLowerCase().includes(busca.toLowerCase()) ||
    (f.anexo ? `anexo ${f.anexo}` : '').includes(busca.toLowerCase())
  );

  if (activeFilter === 'risco') {
    faturasFiltradas = faturasFiltradas.filter(f => f.fator_r_percentual < 2800);
  } else if (activeFilter === 'atencao') {
    faturasFiltradas = faturasFiltradas.filter(f => f.fator_r_percentual >= 2800 && f.fator_r_percentual <= 3000);
  } else if (activeFilter === 'seguro') {
    faturasFiltradas = faturasFiltradas.filter(f => f.fator_r_percentual > 3000);
  }

  const totalPaginas = Math.max(1, Math.ceil(faturasFiltradas.length / itensPorPagina));
  const indexInicio = (paginaAtual - 1) * itensPorPagina;
  const paginadas = faturasFiltradas.slice(indexInicio, indexInicio + itensPorPagina);

  const exportarExcel = () => {
    if (faturasFiltradas.length === 0) return alert("Nenhum dado para exportar.");
    const dados = faturasFiltradas.map(f => ({
      "CÓD": f.cod,
      "CNPJ": f.cnpj,
      "EMPRESA": f.empresa,
      "FATOR R (%)": formatPercentDisplay(f.fator_r_percentual),
      "SITUAÇÃO": f.fator_r_percentual < 2800 ? 'RISCO' : f.fator_r_percentual <= 3000 ? 'ATENÇÃO' : 'SEGURO',
      "ANEXO": f.anexo ? `Anexo ${f.anexo}` : '-',         
      "TABELA": f.descricao_tabela || '-'                  
    }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dados), "Fator R");
    XLSX.writeFile(wb, `FatorR_${mesano}.xlsx`);
  };

  const hasActiveFilters = busca !== '' || activeFilter !== 'all';

  const totalRisco = faturas.filter(f => f.fator_r_percentual < 2800).length;
  const totalAtencao = faturas.filter(f => f.fator_r_percentual >= 2800 && f.fator_r_percentual <= 3000).length;
  const totalSeguro = faturas.filter(f => f.fator_r_percentual > 3000).length;

  return (
    <div className="space-y-6 font-['Poppins'] pb-10 w-full max-w-6xl mx-auto relative z-0">

      {/* Header */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-2 relative z-10">
        <div className="flex items-center gap-5">
          <div className="w-14 h-14 bg-brand-yellow/10 rounded-2xl flex items-center justify-center shrink-0 text-brand-yellow">
            <Percent size={28} />
          </div>
          <div className="space-y-1.5"> {/* Ajustado de 0.5 para 1.5 para dar um respiro melhor */}
            <div>
              <h1 className="text-2xl font-bold text-brand-dark tracking-tight">
                Controle Mensal - <span className="text-brand-yellow font-medium">Fator R</span>
              </h1>
              <p className="text-[13px] text-gray-500 font-medium">
                Análise de conformidade do índice da folha de pagamento.
              </p>
            </div>
            
            {/* Novo bannerzinho informativo */}
            <div className="flex items-center gap-1.5 text-[11px] text-blue-600 bg-blue-50 border border-blue-100 px-2.5 py-1 rounded-md w-fit font-medium tracking-tight">
              <Info size={12} className="shrink-0" />
              <span>Apenas empresas com a apuração concluída são exibidas nesta tela.</span>
            </div>
          </div>
        </div>

        {/* Navegação de Mês */}
        <div className="flex items-center gap-2 bg-white px-3 py-2 rounded-xl shadow-sm border border-gray-100 shrink-0">
          <button onClick={() => shiftMonth(-1)} className="p-1 text-gray-500 hover:text-brand-dark transition-all"><ChevronLeft size={16} /></button>
          <div className="flex items-center gap-2 px-2 border-x border-gray-50">
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
              className="bg-transparent border-none font-bold text-xs text-brand-dark focus:ring-0 cursor-pointer uppercase w-32 p-0 text-center outline-none"
            />
          </div>
          <button onClick={() => shiftMonth(1)} className="p-1 text-gray-500 hover:text-brand-dark transition-all"><ChevronRight size={16} /></button>
        </div>
      </div>

      {/* Cards de Resumo Interativos */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 select-none mt-2 relative z-10">
        <div 
          onClick={() => toggleFilter('seguro')}
          className={`bg-white p-5 rounded-xl flex items-center justify-between relative overflow-hidden group cursor-pointer transition-all duration-200 ${
            activeFilter === 'seguro' 
              ? 'border-2 border-green-500 shadow-md ring-4 ring-green-500/10 scale-[1.02]' 
              : 'border border-gray-100 shadow-sm hover:border-green-200 hover:shadow-md'
          }`}
        >
          <div className={`absolute inset-0 transition-opacity ${activeFilter === 'seguro' ? 'bg-green-50 opacity-100' : 'bg-linear-to-r from-green-50 to-transparent opacity-0 group-hover:opacity-100'}`}></div>
          <div className="relative z-10">
            <p className={`text-[10px] font-black uppercase tracking-widest mb-1 ${activeFilter === 'seguro' ? 'text-green-600' : 'text-gray-500'}`}>Empresas Seguras</p>
            <h3 className="text-3xl font-black text-brand-dark">{totalSeguro}</h3>
          </div>
          <div className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 relative z-10 transition-colors ${activeFilter === 'seguro' ? 'bg-green-500 text-white shadow-lg shadow-green-500/30' : 'bg-green-50 text-green-500'}`}>
            <CheckCircle2 size={24} />
          </div>
        </div>

        <div 
          onClick={() => toggleFilter('atencao')}
          className={`bg-white p-5 rounded-xl flex items-center justify-between relative overflow-hidden group cursor-pointer transition-all duration-200 ${
            activeFilter === 'atencao' 
              ? 'border-2 border-yellow-500 shadow-md ring-4 ring-yellow-500/10 scale-[1.02]' 
              : 'border border-gray-100 shadow-sm hover:border-yellow-200 hover:shadow-md'
          }`}
        >
          <div className={`absolute inset-0 transition-opacity ${activeFilter === 'atencao' ? 'bg-yellow-50 opacity-100' : 'bg-linear-to-r from-yellow-50 to-transparent opacity-0 group-hover:opacity-100'}`}></div>
          <div className="relative z-10">
            <p className={`text-[10px] font-black uppercase tracking-widest mb-1 ${activeFilter === 'atencao' ? 'text-yellow-600' : 'text-gray-500'}`}>Atenção (28% a 30%)</p>
            <h3 className="text-3xl font-black text-brand-dark">{totalAtencao}</h3>
          </div>
          <div className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 relative z-10 transition-colors ${activeFilter === 'atencao' ? 'bg-yellow-500 text-white shadow-lg shadow-yellow-500/30' : 'bg-yellow-50 text-yellow-500'}`}>
            <AlertTriangle size={24} />
          </div>
        </div>

        <div 
          onClick={() => toggleFilter('risco')}
          className={`bg-white p-5 rounded-xl flex items-center justify-between relative overflow-hidden group cursor-pointer transition-all duration-200 ${
            activeFilter === 'risco' 
              ? 'border-2 border-red-500 shadow-md ring-4 ring-red-500/10 scale-[1.02]' 
              : 'border border-gray-100 shadow-sm hover:border-red-200 hover:shadow-md'
          }`}
        >
          <div className={`absolute inset-0 transition-opacity ${activeFilter === 'risco' ? 'bg-red-50 opacity-100' : 'bg-linear-to-r from-red-50 to-transparent opacity-0 group-hover:opacity-100'}`}></div>
          <div className="relative z-10">
            <p className={`text-[10px] font-black uppercase tracking-widest mb-1 ${activeFilter === 'risco' ? 'text-red-600' : 'text-gray-500'}`}>Risco (Abaixo de 28%)</p>
            <h3 className="text-3xl font-black text-brand-dark">{totalRisco}</h3>
          </div>
          <div className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 relative z-10 transition-colors ${activeFilter === 'risco' ? 'bg-red-500 text-white shadow-lg shadow-red-500/30' : 'bg-red-50 text-red-500'}`}>
            <TrendingDown size={24} />
          </div>
        </div>
      </div>

      {/* Toolbar Unificada (Busca + Ações) */}
      <div className="flex flex-col sm:flex-row items-center gap-4 bg-white p-4 rounded-xl shadow-sm border border-gray-100 relative z-10">
        
        <div className="relative w-full flex-1">
          <Search className="absolute left-3 top-2.5 text-gray-500" size={16} />
          <input 
            type="text" 
            placeholder="Buscar Empresa, Cód, Anexo ou Tabela..." 
            value={busca} 
            onChange={(e) => setBusca(e.target.value)} 
            className="pl-10 pr-4 py-2 bg-gray-50 border border-transparent rounded-lg text-xs font-bold outline-none focus:bg-white focus:border-gray-200 focus:shadow-sm w-full text-brand-dark transition-all" 
          />
        </div>
        
        <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto justify-end">
          {hasActiveFilters && (
            <button onClick={limparFiltros} className="shrink-0 text-[9px] uppercase font-bold text-red-400 hover:text-red-600 px-3 transition-colors">
              Limpar Filtros
            </button>
          )}

          <div className="h-8 w-px bg-gray-200 mx-1 hidden sm:block"></div>

          <button onClick={() => fetchData()} title="Atualizar Dados" className="flex items-center justify-center shrink-0 w-9 h-9 bg-brand-yellow text-white rounded-lg font-black hover:shadow-md transition-all">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={exportarExcel} className="flex items-center gap-2 bg-brand-dark text-white px-4 py-2.5 rounded-lg font-black text-[10px] uppercase tracking-widest hover:text-brand-yellow transition-all whitespace-nowrap shrink-0">
            <Download size={14} /> EXCEL
          </button>
        </div>
      </div>

      {/* Tabela Principal */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 relative z-0">
        <div className="overflow-visible min-h-75">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-brand-panel">
                <th className="p-4 text-left text-[10px] uppercase font-black text-gray-500 tracking-widest border-r border-gray-50">Detalhes do Cliente</th>
                <th className="p-4 text-center text-[10px] uppercase font-black text-gray-500 tracking-widest">Fator R Atual</th>
                <th className="p-4 text-right text-[10px] uppercase font-black text-gray-500 tracking-widest border-l border-gray-50">Situação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 relative">
              {loading ? (
                <tr><td colSpan={3} className="p-20 text-center text-gray-300 font-bold"><Loader2 className="animate-spin mx-auto text-brand-yellow mb-2" size={32}/> Carregando dados...</td></tr>
              ) : paginadas.length === 0 ? (
                <tr><td colSpan={3} className="p-20 text-center flex flex-col items-center justify-center"><Users size={40} className="text-gray-200 mb-3" /><p className="text-gray-500 font-bold ">Nenhum registro encontrado</p><p className="text-xs text-gray-300 mt-1">Ajuste os filtros ou a competência.</p></td></tr>
              ) : paginadas.map(f => (
                <tr key={f.cod} className={`hover:bg-gray-50/50 transition-colors group ${f.ativo === false ? 'opacity-70' : ''}`}>
                  
                  {/* --- NOVA RENDERIZAÇÃO DO CLIENTE PADRONIZADA --- */}
                  <td className="p-4 align-top max-w-70 border-r border-gray-50">
                    <div className="flex flex-col gap-0.5">
                      <div className="font-bold text-brand-dark truncate flex items-center gap-1.5" title={f.empresa}>
                        <span className="text-brand-yellow mr-1.5 font-black">{f.cod}</span>
                        {f.empresa}
                        
                        {f.ativo === false && (
                          <span className="bg-red-50 text-red-500 border border-red-100 px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-tight">
                            Inativo
                          </span>
                        )}
                      </div>
                      
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[12px] font-bold text-gray-500 font-mono tracking-tighter">{formatCNPJ(f.cnpj)}</span>
                        
                        {(f.anexo || f.descricao_tabela) && (
                          <>
                            <span className="w-1 h-1 rounded-full bg-gray-200"></span>
                            <InfoTooltip anexo={f.anexo} descricao={f.descricao_tabela} />
                          </>
                        )}
                      </div>
                    </div>
                  </td>
                  {/* ------------------------------------------------ */}

                  <td className="p-4 align-middle text-center bg-brand-panel/30">
                    <div className="text-[26px] font-black text-brand-dark tracking-tighter">
                      {formatPercentDisplay(f.fator_r_percentual)}
                    </div>
                  </td>

                  <td className="p-4 align-middle text-right border-l border-gray-50">
                    <div className="flex justify-end">
                      {f.fator_r_percentual < 2800 ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase bg-red-50 text-red-600 border border-red-100">
                          <TrendingDown size={14} /> Risco
                        </span>
                      ) : f.fator_r_percentual <= 3000 ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase bg-yellow-50 text-yellow-600 border border-yellow-100">
                          <AlertTriangle size={14} /> Atenção
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase bg-green-50 text-green-600 border border-green-100">
                          <CheckCircle2 size={14} /> Seguro
                        </span>
                      )}
                    </div>
                  </td>
                  
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        
        {!loading && faturasFiltradas.length > 0 && (
          <div className="bg-gray-50/50 border-t border-gray-100 p-4 flex items-center justify-between text-[10px] font-black text-gray-500 uppercase tracking-widest relative z-10">
            <div>
              Mostrando <span className="text-brand-dark">{indexInicio + 1} - {Math.min(indexInicio + paginadas.length, faturasFiltradas.length)}</span> de {faturasFiltradas.length}
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => setPaginaAtual(prev => Math.max(prev - 1, 1))} disabled={paginaAtual === 1} className="p-2 rounded-lg hover:bg-white hover:shadow-sm disabled:opacity-20 transition-all text-brand-dark border border-transparent hover:border-gray-200"><ChevronLeft size={16} /></button>
              <span className="text-brand-dark bg-white px-3 py-1 rounded-md border border-gray-200 shadow-sm font-bold">Pág {paginaAtual} / {totalPaginas}</span>
              <button onClick={() => setPaginaAtual(prev => Math.min(prev + 1, totalPaginas))} disabled={paginaAtual === totalPaginas} className="p-2 rounded-lg hover:bg-white hover:shadow-sm disabled:opacity-20 transition-all text-brand-dark border border-transparent hover:border-gray-200"><ChevronRight size={16} /></button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};