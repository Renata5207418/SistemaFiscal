import React, { useEffect, useState, useCallback, useMemo } from 'react';
import api from '../services/api';
import Chart from 'react-apexcharts';
import { 
  Calendar, AlertTriangle, Activity, AlertCircle, TrendingUp, CheckCircle2,
  ListTodo, CheckSquare, Square, Clock, AlertOctagon, Users, PieChart
} from 'lucide-react';

// --- IMPORTAÇÕES PARA DATA EM PORTUGUÊS ---
import DatePicker, { registerLocale } from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { ptBR } from "date-fns/locale"; 

registerLocale("pt-BR", ptBR);

interface TarefaMensal {
  _id: string;
  onda: number;
  prazo: string;
  descricao: string;
  concluido: boolean;
  updated_by: string | null;
  updated_at?: string | null;
}

// --- FUNÇÃO INTELIGENTE DE ORDENAÇÃO DE GRUPOS (Padronizada) ---
const ordenarGrupos = (a: string, b: string) => {
  if (a === 'Sem Grupo') return 1;
  if (b === 'Sem Grupo') return -1;

  const regex = /^(\d+)?\s*(.*)$/i;
  const matchA = a.match(regex);
  const matchB = b.match(regex);

  const numA = matchA && matchA[1] ? parseInt(matchA[1], 10) : 0;
  const textA = matchA && matchA[2] ? matchA[2].toUpperCase().trim() : a.toUpperCase().trim();

  const numB = matchB && matchB[1] ? parseInt(matchB[1], 10) : 0;
  const textB = matchB && matchB[2] ? matchB[2].toUpperCase().trim() : b.toUpperCase().trim();

  const getPeso = (txt: string) => {
    if (txt === 'SN') return 1;
    if (txt === 'LP') return 2;
    return 3; 
  };

  const pesoA = getPeso(textA);
  const pesoB = getPeso(textB);

  if (pesoA !== pesoB) return pesoA - pesoB;
  if (numA !== numB) return numA - numB;
  
  return a.localeCompare(b, undefined, { numeric: true });
};

export const Dashboard: React.FC = () => {
  const [mesano, setMesano] = useState(() => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  
  const [abaAtiva, setAbaAtiva] = useState<'geral' | 'simples' | 'regime_normal' | 'tarefas'>('geral');
  const [loading, setLoading] = useState(true);
  const [clientesBase, setClientesBase] = useState<any[]>([]);

  const [geral, setGeral] = useState({ 
    kpis: { 
      certificados_vencidos: 0, 
      certificados_atencao: 0, 
      fator_r_risco: 0, 
      fator_r_atencao: 0 
    }, 
    movimento_mes: { labels: [], series: [] }, 
    sem_mov_3m: { labels: [], series: [] } 
  });

  const [simples, setSimples] = useState({ 
    onvio: { postadas: 0, total: 0 }, 
    dif_fat: { labels: [], series: [] }, 
    dif_dec: { labels: [], series: [] } 
  });

  const [regimeNormal, setRegimeNormal] = useState({ 
    dif_fat: { labels: [], series: [] } 
  });

  const [tarefas, setTarefas] = useState<TarefaMensal[]>([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const mesFormatado = mesano.replace('-', '');
      
      const [resGeral, resSimples, resRN, resTarefas, resClientes] = await Promise.all([
        api.get(`/dashboard/v2/geral?mesano=${mesFormatado}`),
        api.get(`/dashboard/v2/simples?mesano=${mesFormatado}`),
        api.get(`/dashboard/v2/regime-normal?mesano=${mesFormatado}`),
        api.get(`/dashboard/v2/tarefas-mensais?mesano=${mesFormatado}`),
        api.get('/certificados/listar_completos')
      ]);

      if (resGeral.data) setGeral(resGeral.data);
      if (resSimples.data) setSimples(resSimples.data);
      if (resRN.data) setRegimeNormal(resRN.data);
      if (resTarefas.data?.data) setTarefas(resTarefas.data.data);
      if (resClientes.data?.empresas) setClientesBase(resClientes.data.empresas);

    } catch (error) {
      console.error("Erro ao carregar dashboard:", error);
    } finally {
      setLoading(false);
    }
  }, [mesano]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleToggleTarefa = async (id: string, statusAtual: boolean) => {
    const agora = new Date().toISOString();     
    setTarefas(prev => prev.map(t => 
      t._id === id ? { ...t, concluido: !statusAtual, updated_at: agora } : t
    ));
    
    try {
      await api.put(`/dashboard/v2/tarefas-mensais/${id}`, { concluido: !statusAtual });
    } catch (error) {
      console.error("Erro ao atualizar tarefa", error);
      setTarefas(prev => prev.map(t => 
        t._id === id ? { ...t, concluido: statusAtual } : t
      ));
    }
  };

  // --- ESTATÍSTICAS PARA VISÃO GERAL ---
  const clienteStats = useMemo(() => {
    const regimes: Record<string, number> = {};
    const grupos: Record<string, number> = {};

    clientesBase.forEach(c => {
      if (c.ativo) {
        const r = c.regime_tributario || 'Não Informado';
        regimes[r] = (regimes[r] || 0) + 1;

        let g = c.grupo ? c.grupo.trim() : '';
        if (!g || g === '-' || g.toLowerCase() === 'sem grupo') g = 'Sem Grupo';
        grupos[g] = (grupos[g] || 0) + 1;
      }
    });

    return {
      regimes: {
        labels: Object.keys(regimes),
        series: Object.values(regimes)
      },
      grupos: Object.entries(grupos).sort((a, b) => ordenarGrupos(a[0], b[0]))
    };
  }, [clientesBase]);

  const gerarDonutOptions = (labels: string[], colors: string[]): any => ({
    chart: { type: 'donut', fontFamily: 'Poppins' },
    labels: labels,
    colors: colors,
    legend: { position: 'bottom', fontWeight: 700 },
    stroke: { width: 0 },
    dataLabels: { enabled: true, dropShadow: { enabled: false } },
    plotOptions: { pie: { donut: { size: '65%' } } }
  });

  const barOptions: any = {
    chart: { type: 'bar', toolbar: { show: false }, fontFamily: 'Poppins' },
    plotOptions: { bar: { horizontal: true, borderRadius: 4, distributed: true } },
    colors: ['#f7b714', '#28303d', '#08a63e'], 
    dataLabels: { enabled: true, style: { colors: ['#fff'] } },
    xaxis: { categories: geral.sem_mov_3m.labels },
    legend: { show: false }
  };

  const totalTarefas = tarefas.length;
  const concluidasTotal = tarefas.filter(t => t.concluido).length;
  const progressoGeral = totalTarefas ? Math.round((concluidasTotal / totalTarefas) * 100) : 0;

  const getProgressoOnda = (onda: number) => {
    const tasksOnda = tarefas.filter(t => t.onda === onda);
    if (!tasksOnda.length) return { total: 0, concluidas: 0, pct: 0 };
    const concluidas = tasksOnda.filter(t => t.concluido).length;
    return { total: tasksOnda.length, concluidas, pct: Math.round((concluidas / tasksOnda.length) * 100) };
  };

  const checkAtraso = (ondaNum: number, pctConcluido: number) => {
    if (pctConcluido === 100) return false; 
    const [anoCompStr, mesCompStr] = mesano.split('-');
    let anoExecucao = parseInt(anoCompStr, 10);
    let mesExecucao = parseInt(mesCompStr, 10) + 1; 
    if (mesExecucao > 12) { mesExecucao = 1; anoExecucao += 1; }
    const hoje = new Date();
    const anoHoje = hoje.getFullYear();
    const mesHoje = hoje.getMonth() + 1; 
    const diaHoje = hoje.getDate();
    if (anoHoje > anoExecucao || (anoHoje === anoExecucao && mesHoje > mesExecucao)) return true;
    if (anoHoje === anoExecucao && mesHoje === mesExecucao) {
      if (ondaNum === 1 && diaHoje > 10) return true;
      if (ondaNum === 2 && diaHoje > 20) return true;
    }    
    return false;
  };

  const pOnda1 = getProgressoOnda(1);
  const pOnda2 = getProgressoOnda(2);
  const pOnda3 = getProgressoOnda(3);

  return (
    <div className="space-y-6 font-['Poppins'] pb-10">
      
      {/* HEADER E FILTRO DE DATA */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 mb-6 px-2">
        <div className="flex items-center gap-5">
          <div className="w-14 h-14 bg-brand-yellow/10 rounded-2xl flex items-center justify-center shrink-0 text-brand-yellow">
            <TrendingUp size={28} />
          </div>
          <div className="space-y-0.5">
            <h1 className="text-2xl font-bold text-brand-dark tracking-tight">Painel <span className="text-brand-yellow font-medium">Executivo</span></h1>
            <p className="text-[13px] text-gray-500 font-medium">Acompanhe a saúde da operação e o fechamento do mês.</p>
          </div>
        </div>

        <div className="flex items-center bg-white p-2 rounded-xl shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 bg-gray-50 p-1.5 rounded-lg border border-gray-100">
            <Calendar size={16} className="text-brand-yellow ml-2" />
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
              className="bg-transparent border-none font-bold text-sm text-brand-dark focus:ring-0 cursor-pointer uppercase outline-none pr-2 w-44"
            />
          </div>
        </div>
      </div>

      {/* NAVEGAÇÃO DE ABAS */}
      <div className="flex flex-wrap gap-6 md:gap-8 border-b border-gray-200 px-4 mb-6">
        <button onClick={() => setAbaAtiva('geral')} className={`pb-3 text-xs font-black uppercase tracking-widest transition-all border-b-2 ${abaAtiva === 'geral' ? 'border-brand-yellow text-brand-dark' : 'border-transparent text-gray-500 hover:text-gray-600'}`}>Visão Geral</button>
        <button onClick={() => setAbaAtiva('tarefas')} className={`pb-3 text-xs font-black uppercase tracking-widest transition-all border-b-2 flex items-center gap-1.5 ${abaAtiva === 'tarefas' ? 'border-brand-yellow text-brand-dark' : 'border-transparent text-gray-500 hover:text-gray-600'}`}>
          <ListTodo size={14} className={abaAtiva === 'tarefas' ? 'border-brand-yellow text-brand-dark' : 'text-gray-500'} /> Rotina do Mês
        </button>
        <button onClick={() => setAbaAtiva('simples')} className={`pb-3 text-xs font-black uppercase tracking-widest transition-all border-b-2 ${abaAtiva === 'simples' ? 'border-brand-yellow text-brand-dark' : 'border-transparent text-gray-500 hover:text-gray-600'}`}>Simples Nacional</button>
        <button onClick={() => setAbaAtiva('regime_normal')} className={`pb-3 text-xs font-black uppercase tracking-widest transition-all border-b-2 ${abaAtiva === 'regime_normal' ? 'border-brand-yellow text-brand-dark' : 'border-transparent text-gray-500 hover:text-gray-600'}`}>Regime Normal</button>
      </div>

      {loading ? (
        <div className="flex justify-center py-20 text-gray-300 animate-pulse font-bold text-lg">
          <Activity size={24} className="mr-2 animate-spin" /> Atualizando painel...
        </div>
      ) : (
        <div className="animate-in fade-in duration-300">
          
          {abaAtiva === 'geral' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-red-100 flex items-center justify-between group transition-all">
                  <div className="w-full">
                    <p className="text-[11px] font-black uppercase tracking-widest text-red-500 mb-3">Saúde dos Certificados</p>
                    <div className="flex items-center gap-4 xl:gap-6">
                      <div>
                        <p className="text-[9px] font-black uppercase tracking-widest text-gray-500 mb-0.5">Vencidos/Faltam</p>
                        <h3 className="text-2xl xl:text-3xl font-black text-red-500 leading-none">{geral.kpis.certificados_vencidos}</h3>
                      </div>
                      <div className="w-px h-10 bg-gray-100"></div>
                      <div>
                        <p className="text-[9px] font-black uppercase tracking-widest text-gray-500 mb-0.5">Vencem 30 dias</p>
                        <h3 className="text-2xl xl:text-3xl font-black text-yellow-500 leading-none">{geral.kpis.certificados_atencao}</h3>
                      </div>
                    </div>
                  </div>
                  <div className="w-12 h-12 xl:w-14 xl:h-14 bg-red-50 text-red-500 rounded-full flex items-center justify-center shrink-0"><AlertTriangle size={24} /></div>
                </div>

                <div className="bg-white p-6 rounded-2xl shadow-sm border border-orange-100 flex items-center justify-between group transition-all">
                  <div className="w-full">
                    <p className="text-[11px] font-black uppercase tracking-widest text-orange-500 mb-3">Alertas Fator R (&le; 30%)</p>
                    <div className="flex items-center gap-4 xl:gap-6">
                      <div>
                        <p className="text-[9px] font-black uppercase tracking-widest text-gray-500 mb-0.5">Risco (&lt;28%)</p>
                        <h3 className="text-2xl xl:text-3xl font-black text-red-500 leading-none">{geral.kpis.fator_r_risco}</h3>
                      </div>
                      <div className="w-px h-10 bg-gray-100"></div>
                      <div>
                        <p className="text-[9px] font-black uppercase tracking-widest text-gray-500 mb-0.5">Atenção (28%-30%)</p>
                        <h3 className="text-2xl xl:text-3xl font-black text-yellow-500 leading-none">{geral.kpis.fator_r_atencao}</h3>
                      </div>
                    </div>
                  </div>
                  <div className="w-12 h-12 xl:w-14 xl:h-14 bg-orange-50 text-orange-500 rounded-full flex items-center justify-center shrink-0"><AlertCircle size={24} /></div>
                </div>

                <div 
                  onClick={() => setAbaAtiva('tarefas')}
                  className="bg-white p-6 rounded-2xl shadow-sm border border-blue-100 flex flex-col justify-between group transition-all hover:shadow-md hover:border-blue-200 cursor-pointer relative overflow-hidden"
                >
                  <div className="absolute top-0 left-0 w-full h-1 bg-gray-100">
                    <div className={`h-full transition-all duration-1000 ${progressoGeral === 100 ? 'bg-green-500' : 'bg-blue-500'}`} style={{ width: `${progressoGeral}%` }}></div>
                  </div>
                  <div className="flex items-start justify-between w-full mb-4 mt-1">
                    <div>
                      <p className="text-[11px] font-black uppercase tracking-widest text-blue-500 mb-1">Progresso do Mês</p>
                      <div className="flex items-baseline gap-2">
                        <h3 className="text-3xl font-black text-brand-dark leading-none">{progressoGeral}%</h3>
                        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Concluído</span>
                      </div>
                    </div>
                    <div className="w-12 h-12 bg-blue-50 text-blue-500 rounded-full flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform"><ListTodo size={24} /></div>
                  </div>

                  <div className="flex items-center justify-between w-full pt-3 border-t border-gray-50">
                    <div className="flex flex-col gap-1 items-center">
                      <span className={`text-[9px] font-black uppercase ${checkAtraso(1, pOnda1.pct) ? 'text-red-500' : 'text-gray-500'}`}>Início do Mês</span>
                      <div className="w-10 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                        <div className={`h-full ${checkAtraso(1, pOnda1.pct) ? 'bg-red-500' : 'bg-green-500'}`} style={{ width: `${pOnda1.pct}%` }}></div>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1 items-center">
                      <span className={`text-[9px] font-black uppercase ${checkAtraso(2, pOnda2.pct) ? 'text-red-500' : 'text-gray-500'}`}>Meio do Mês</span>
                      <div className="w-10 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                        <div className={`h-full ${checkAtraso(2, pOnda2.pct) ? 'bg-red-500' : 'bg-brand-gold'}`} style={{ width: `${pOnda2.pct}%` }}></div>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1 items-center">
                      <span className={`text-[9px] font-black uppercase ${checkAtraso(3, pOnda3.pct) ? 'text-red-500' : 'text-gray-500'}`}>Fim do Mês</span>
                      <div className="w-10 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                        <div className={`h-full ${checkAtraso(3, pOnda3.pct) ? 'bg-red-500' : 'bg-blue-500'}`} style={{ width: `${pOnda3.pct}%` }}></div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* DASHBOARD DE CARTEIRA (NOVO) */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col">
                  <h3 className="text-sm font-bold text-brand-dark mb-6 text-center flex items-center justify-center gap-2">
                    <PieChart size={18} className="text-brand-yellow" /> Distribuição por Regime
                  </h3>
                  <div className="flex justify-center flex-1 items-center">
                    {clienteStats.regimes.series.length > 0 ? (
                      <Chart 
                        options={gerarDonutOptions(clienteStats.regimes.labels, ['#155dfc', '#f7b714', '#fb2c36', '#08a63e'])} 
                        series={clienteStats.regimes.series} 
                        type="donut" 
                        height={280} 
                      />
                    ) : (
                      <span className="text-gray-500 font-bold text-sm">Sem dados de clientes.</span>
                    )}
                  </div>
                </div>

                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col h-90">
                  <h3 className="text-sm font-bold text-brand-dark mb-4 text-center flex items-center justify-center gap-2">
                    <Users size={18} className="text-brand-yellow" /> Clientes por Grupo Econômico
                  </h3>
                  <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-2">
                    {clienteStats.grupos.length > 0 ? (
                      clienteStats.grupos.map(([nome, qtd]) => (
                        <div key={nome} className="flex justify-between items-center text-sm border-b border-gray-50 pb-2 last:border-0 hover:bg-gray-50/50 transition-colors p-1 rounded-md">
                          <span className={`font-bold ${nome === 'Sem Grupo' ? 'text-gray-500 italic' : 'text-brand-dark'}`}>
                            {nome}
                          </span>
                          <span className="bg-white border border-gray-200 px-2.5 py-1 rounded-md text-xs font-black text-brand-yellow shadow-sm">
                            {qtd}
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="flex items-center justify-center h-full text-gray-500 font-bold text-sm">Sem dados de clientes.</div>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                  <h3 className="text-sm font-bold text-brand-dark mb-6 text-center">Movimentação no Mês</h3>
                  <div className="flex justify-center">
                    <Chart options={gerarDonutOptions(geral.movimento_mes.labels, ['#08a63e', '#3a3a3a'])} series={geral.movimento_mes.series} type="donut" height={280} />
                  </div>
                </div>
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                  <h3 className="text-sm font-bold text-brand-dark mb-4 text-center">Sem Movimento (Últimos 3 Meses)</h3>
                  {geral.sem_mov_3m.series.length > 0 ? (
                    <Chart options={barOptions} series={[{ name: "Empresas", data: geral.sem_mov_3m.series }]} type="bar" height={280} />
                  ) : (
                    <div className="flex items-center justify-center h-48 text-gray-500 font-bold text-sm">Todas as empresas tiveram movimento!</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {abaAtiva === 'tarefas' && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 md:p-8 animate-in slide-in-from-bottom-2 duration-300">
              <div className="flex items-center justify-between mb-8 pb-4 border-b border-gray-100">
                <div>
                  <h2 className="text-xl font-bold text-brand-dark tracking-tight">Checklist do Escritório</h2>
                  <p className="text-xs text-gray-500 font-medium mt-1">Controle interno de obrigações da competência {mesano}</p>
                </div>
                <div className="text-right hidden sm:block">
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-1">Progresso Global</p>
                  <div className="flex items-center gap-3">
                    <div className="w-32 h-2.5 rounded-full bg-gray-100 overflow-hidden">
                       <div className="h-full bg-blue-500 transition-all duration-1000" style={{ width: `${progressoGeral}%` }}></div>
                    </div>
                    <span className="text-sm font-black text-blue-600">{progressoGeral}%</span>
                  </div>
                </div>
              </div>
              {tarefas.length === 0 ? (
                <div className="text-center py-20 text-gray-500 font-bold">Nenhuma tarefa encontrada para este mês.</div>
              ) : (
                <div className="space-y-8">
                  {[1, 2, 3].map((ondaNum) => {
                    const tasksDaOnda = tarefas.filter(t => t.onda === ondaNum);
                    if (tasksDaOnda.length === 0) return null;
                    const ondaProgresso = getProgressoOnda(ondaNum);
                    const isOndaConcluida = ondaProgresso.pct === 100;
                    const isAtrasada = checkAtraso(ondaNum, ondaProgresso.pct);
                    let headerColor = "text-blue-600";
                    let bgIcon = "bg-blue-50";
                    if (ondaNum === 1) { headerColor = "text-green-600"; bgIcon = "bg-green-50"; }
                    if (ondaNum === 2) { headerColor = "text-brand-gold"; bgIcon = "bg-brand-gold/10"; }
                    if (isAtrasada) { headerColor = "text-red-500"; bgIcon = "bg-red-50"; }
                    if (isOndaConcluida) { headerColor = "text-gray-500"; bgIcon = "bg-gray-50"; }
                    const nomeOnda = ondaNum === 1 ? 'Início do mês' : ondaNum === 2 ? 'Meio do mês' : 'Fim do mês';
                    return (
                      <div key={ondaNum} className="space-y-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${bgIcon} ${headerColor}`}>
                              {isOndaConcluida ? <CheckCircle2 size={18} /> : isAtrasada ? <AlertOctagon size={18} className="animate-pulse" /> : <Clock size={18} />}
                            </div>
                            <div>
                              <h3 className={`text-sm font-black uppercase tracking-widest ${isOndaConcluida ? 'text-gray-500 line-through decoration-gray-300' : headerColor}`}>
                                {nomeOnda}
                              </h3>
                              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">{tasksDaOnda[0].prazo}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            {isAtrasada && !isOndaConcluida && (
                              <span className="text-[9px] font-black uppercase tracking-widest text-red-500 bg-red-50 px-2 py-1 rounded">Atrasado</span>
                            )}
                            <span className={`text-[10px] font-black ${isOndaConcluida ? 'text-green-500' : isAtrasada ? 'text-red-500' : 'text-gray-500'}`}>
                              {ondaProgresso.concluidas} de {ondaProgresso.total}
                            </span>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pl-2 md:pl-11">
                          {tasksDaOnda.map(tarefa => (
                            <div key={tarefa._id} onClick={() => handleToggleTarefa(tarefa._id, tarefa.concluido)} className={`group flex items-center gap-3 p-4 rounded-xl border cursor-pointer transition-all ${tarefa.concluido ? 'bg-gray-50 border-transparent shadow-inner opacity-75 hover:opacity-100' : isAtrasada ? 'bg-red-50/30 border-red-100 hover:border-red-300' : 'bg-white border-gray-200 shadow-sm hover:border-blue-300 hover:shadow-md'}`}>
                              <div className="shrink-0">
                                {tarefa.concluido ? <CheckSquare size={22} className="text-green-500" /> : <Square size={22} className={`group-hover:text-blue-400 ${isAtrasada ? 'text-red-300' : 'text-gray-300'}`} />}
                              </div>
                              <div className="flex flex-col">
                                <span className={`text-xs md:text-sm font-bold ${tarefa.concluido ? 'text-gray-500 line-through' : 'text-brand-dark group-hover:text-blue-600'}`}>
                                  {tarefa.descricao}
                                </span>
                                {tarefa.concluido && (
                                  <span className="text-[9px] font-bold text-gray-500 mt-0.5 uppercase tracking-widest">
                                    ✓ Por {tarefa.updated_by || 'Sistema'} {tarefa.updated_at ? `em ${new Date(tarefa.updated_at).toLocaleDateString('pt-BR')}` : ''}
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {abaAtiva === 'simples' && (
            <div className="space-y-6">
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-green-100 flex items-center justify-between relative overflow-hidden">
                <div className="absolute top-0 left-0 w-1.5 h-full bg-green-500"></div>
                <div>
                  <p className="text-xs font-black uppercase tracking-widest text-green-600 mb-2 flex items-center gap-2"><CheckCircle2 size={16}/> Guias Publicadas no Onvio</p>
                  <div className="flex items-baseline gap-2">
                    <h3 className="text-4xl font-black text-brand-dark">{simples.onvio.postadas}</h3>
                    <span className="text-lg font-bold text-gray-500">/ {simples.onvio.total} ativas</span>
                  </div>
                </div>
                <div className="w-1/3 bg-gray-100 h-4 rounded-full overflow-hidden hidden md:block">
                   <div className="bg-green-500 h-full rounded-full transition-all duration-1000" style={{ width: `${simples.onvio.total > 0 ? (simples.onvio.postadas / simples.onvio.total) * 100 : 0}%` }}></div>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                  <h3 className="text-sm font-bold text-brand-dark mb-6 text-center">Diferença de Faturamento (XML x Domínio)</h3>
                  <div className="flex justify-center">
                    <Chart options={gerarDonutOptions(simples.dif_fat.labels, ['#08a63e', '#fb2c36'])} series={simples.dif_fat.series} type="donut" height={300} />
                  </div>
                </div>
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                  <h3 className="text-sm font-bold text-brand-dark mb-6 text-center">Diferença de Declaração (PGDAS x Domínio)</h3>
                  <div className="flex justify-center">
                     <Chart options={gerarDonutOptions(simples.dif_dec.labels, ['#08a63e', '#fb2c36', '#f7b714', '#3a3a3a'])} series={simples.dif_dec.series} type="donut" height={300} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {abaAtiva === 'regime_normal' && (
            <div className="grid grid-cols-1 gap-6">
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                <h3 className="text-sm font-bold text-brand-dark mb-6 text-center">Diferença de Faturamento (XML x Domínio)</h3>
                <div className="flex justify-center">
                  <Chart options={gerarDonutOptions(regimeNormal.dif_fat.labels, ['#08a63e', '#fb2c36'])} series={regimeNormal.dif_fat.series} type="donut" height={350} />
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      <style>{`.custom-scrollbar::-webkit-scrollbar{width:4px}.custom-scrollbar::-webkit-scrollbar-track{background:#f1f1f1;border-radius:4px}.custom-scrollbar::-webkit-scrollbar-thumb{background:#d1d5db;border-radius:4px}`}</style>
    </div>
  );
};