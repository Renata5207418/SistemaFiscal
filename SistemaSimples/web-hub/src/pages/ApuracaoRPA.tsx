import React, { useState, useEffect, useRef } from 'react';
import api from '../services/api';
import { Play, UploadCloud, FileSpreadsheet, Download, RefreshCw, Eye, EyeOff, Clock, User, Eraser, Bot, History } from 'lucide-react';

export const ApuracaoRPA: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [usuario, setUsuario] = useState('');
  const [senha, setSenha] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  
  const [status, setStatus] = useState<'ocioso' | 'processando' | 'erro'>('ocioso');
  const [progresso, setProgresso] = useState<any>({ messages: [], is_running: false, processed_count: 0, total_count: 0 });
  const [currentUserRPA, setCurrentUserRPA] = useState<string | null>(null);
  
  const [historico, setHistorico] = useState<any[]>([]);
  const [, setErroMsg] = useState('');
  
  const terminalRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const verificarStatusInicial = async () => {
    try {
      const { data } = await api.get('/automacao/rpa/status-atual');
      setProgresso(data.last_progress);
      setCurrentUserRPA(data.last_user);
      
      // Só atualiza o histórico se ele vier populado (previne piscar)
      if (data.history && data.history.length > 0) {
          setHistorico(data.history);
      }

      if (data.is_running) {
        setStatus('processando');
      } else {
        setStatus('ocioso');
      }
    } catch (err) {
      console.error("Erro ao verificar status inicial do RPA");
    }
  };

  useEffect(() => { verificarStatusInicial(); }, []);

  useEffect(() => {
    const container = terminalRef.current;
    if (container) {
      const isAtBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 100;
      if (isAtBottom) {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [progresso.messages]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (status === 'processando') {
      interval = setInterval(async () => {
        try {
          const { data } = await api.get('/automacao/rpa/status-atual');
          setProgresso(data.last_progress);
          setCurrentUserRPA(data.last_user);
          
          if (!data.is_running) {
             if (data.history && data.history.length > 0) {
                 setHistorico(data.history);
             }
            setStatus('ocioso');
          }
        } catch (err) {
          console.error("Erro no polling do RPA");
        }
      }, 2500);
    }
    return () => clearInterval(interval);
  }, [status]);

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      setFile(e.dataTransfer.files[0]);
    }
  };

  const handleLimparTerminal = async () => {
    if (!window.confirm("Deseja limpar as mensagens do terminal?")) return;
    try {
      await api.post('/automacao/rpa/limpar');
      setProgresso({ messages: [], processed_count: 0, total_count: 0 });
      setErroMsg('');
    } catch (err) {
      alert("Não foi possível limpar o terminal agora.");
    }
  };

  const iniciarApuracao = async () => {
    if (!file || !usuario || !senha) {
      alert("Preencha todos os campos e anexe a planilha.");
      return;
    }

    setProgresso({ messages: [], processed_count: 0, total_count: 0 });
    setStatus('processando');
    setErroMsg('');

    const formData = new FormData();
    formData.append('arquivo_empresas', file);
    formData.append('usuario', usuario);
    formData.append('senha', senha);

    try {
      // O histórico só será atualizado pelo Polling assim que o robô parar
      await api.post('/automacao/rpa/apurar', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 3600000 
      });
      
      verificarStatusInicial(); // Força puxar o histórico do banco no final
      
    } catch (err: any) {
      if (err.response?.status === 423) {
        alert(err.response.data.detail);
        verificarStatusInicial();
      } else {
        setStatus('erro');
        setErroMsg(err.response?.data?.detail || "Erro de comunicação com o robô.");
        verificarStatusInicial(); 
      }
    }
  };

  const handleDownload = async (filename: string) => {
    try {
      const response = await api.get(`/automacao/rpa/download/${filename}`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      alert("Erro ao baixar o arquivo. Pode ter expirado ou não estar mais no servidor.");
    }
  };

  return (
    <div className="space-y-6 font-['Poppins'] pb-10">
      
      {/* Cabeçalho */}
      <div className="mb-8 flex items-center justify-between px-2">
        <div className="flex items-center gap-5">
          <div className="w-14 h-14 bg-brand-yellow/10 rounded-2xl flex items-center justify-center shrink-0 text-brand-yellow">
            <Bot size={28} />
          </div>
          <div className="space-y-0.5">
            <h1 className="text-2xl font-bold text-brand-dark tracking-tight">
              Apuração Domínio <span className="text-gray-500 font-medium">(RPA)</span>
            </h1>
            <p className="text-[13px] text-gray-500 font-medium">
              Controle centralizado e monitoramento do robô de apuração.
            </p>
          </div>
        </div>

        {/* Botão Rápido de Últimos Downloads */}
        {historico.length > 0 && (
           <div className="relative group z-50">           
              <button className="flex items-center gap-2 bg-white border border-gray-200 px-4 py-3 rounded-xl text-xs font-bold text-gray-600 hover:border-brand-yellow transition-all shadow-sm">
                <History size={16} className="text-brand-yellow" /> Últimos Downloads
              </button>
              <span className="text-[9px] font-medium text-gray-500 italic">
                 *Resultados disponíveis por 24h
              </span>
              
              <div className="absolute right-0 mt-2 w-80 bg-white border border-gray-100 rounded-xl shadow-xl p-2 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 transform origin-top-right">
                <div className="text-[10px] font-black text-gray-500 uppercase tracking-widest px-3 pt-2 pb-3 border-b border-gray-50 mb-1">
                  Arquivos Recentes
                </div>
                <div className="max-h-64 overflow-y-auto custom-scrollbar flex flex-col gap-1">
                  {historico.map((item, idx) => (
                    item.relatorio ? (
                       <button 
                         key={idx}
                         onClick={() => handleDownload(item.relatorio)}
                         className="flex flex-col items-start p-3 hover:bg-gray-50 rounded-lg transition-colors border border-transparent hover:border-gray-100 text-left w-full"
                       >
                         <span className="text-xs font-bold text-brand-navy truncate w-full flex items-center gap-2">
                           <FileSpreadsheet size={14} className="text-green-500 shrink-0" /> {item.relatorio}
                         </span>
                         <span className="text-[9px] font-bold text-gray-500 mt-1 flex gap-2">
                           <Clock size={10} /> {item.horario} • {item.executado_por}
                         </span>
                       </button>
                    ) : null
                  ))}
                </div>
              </div>
           </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Lado Esquerdo: Configurações */}
        <div className="lg:col-span-1 bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex flex-col gap-6 relative z-0">
          {status === 'processando' && currentUserRPA && (
            <div className="bg-amber-50 border border-amber-200 p-4 rounded-lg flex items-center gap-3">
              <User className="text-amber-600" size={20} />
              <div className="text-[11px] font-bold text-amber-800 uppercase leading-tight">
                Robô em uso por: <br /> <span className="text-sm">{currentUserRPA}</span>
              </div>
            </div>
          )}

          <div className="space-y-4">
            <h2 className="font-bold text-brand-dark border-b border-gray-100 pb-2 text-sm">Configuração</h2>
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-black text-gray-500 tracking-widest">Usuário Domínio</label>
              <input type="text" value={usuario} onChange={e => setUsuario(e.target.value)} disabled={status === 'processando'} className="w-full p-3 bg-gray-50 border border-transparent rounded-lg text-sm font-semibold outline-none focus:bg-white focus:border-brand-yellow text-brand-dark disabled:opacity-50" />
            </div>
            <div className="space-y-1 relative">
              <label className="text-[10px] uppercase font-black text-gray-500 tracking-widest">Senha Domínio</label>
              <input type={showPassword ? "text" : "password"} value={senha} onChange={e => setSenha(e.target.value)} disabled={status === 'processando'} className="w-full p-3 bg-gray-50 border border-transparent rounded-lg text-sm font-semibold outline-none focus:bg-white focus:border-brand-yellow text-brand-dark disabled:opacity-50" />
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-8 text-gray-500 hover:text-brand-yellow">
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[10px] uppercase font-black text-gray-500 tracking-widest">Planilha (.xlsx)</label>
              <a 
                href="/padrao_apuracao_rpa.xlsx" 
                download="padrao_apuracao_rpa.xlsx"
                className="flex items-center gap-1.5 text-[9px] uppercase font-black text-brand-yellow hover:text-white hover:bg-brand-yellow transition-colors bg-brand-yellow/10 px-2.5 py-1.5 rounded-md"
              >
                <Download size={12} /> Planilha padrão
              </a>
            </div>
            <div onDragOver={(e) => e.preventDefault()} onDrop={handleFileDrop} className={`border-2 border-dashed rounded-xl p-8 text-center transition-all ${file ? 'border-brand-yellow bg-blue-50/20' : 'border-gray-200 bg-gray-50 hover:bg-gray-100'} ${status === 'processando' ? 'opacity-50 cursor-not-allowed' : ''}`}>
              <input type="file" accept=".xlsx" onChange={(e) => setFile(e.target.files?.[0] || null)} className="hidden" id="fileUpload" disabled={status === 'processando'} />
              <label htmlFor="fileUpload" className={`flex flex-col items-center gap-3 ${status === 'processando' ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
                {file ? (<><FileSpreadsheet size={36} className="text-brand-yellow" /><span className="text-sm font-bold text-brand-dark truncate w-full px-4">{file.name}</span></>) : (<><UploadCloud size={36} className="text-gray-300" /><span className="text-sm font-bold text-gray-500 px-4">Arraste a planilha aqui</span></>)}
              </label>
            </div>
          </div>

          <div className="flex flex-col gap-2 mt-auto">
            <button onClick={iniciarApuracao} disabled={status === 'processando' || !file || !usuario || !senha} className="w-full bg-brand-dark text-white py-4 rounded-lg font-black text-[11px] uppercase tracking-widest hover:text-brand-yellow transition-all disabled:bg-gray-200 disabled:text-gray-500 flex items-center justify-center gap-2 shadow-md">
              {status === 'processando' ? <><RefreshCw size={16} className="animate-spin" /> Robô Ocupado</> : <><Play size={16} /> Iniciar Processo</>}
            </button>
            
            {progresso.messages.length > 0 && status !== 'processando' && (
              <button onClick={handleLimparTerminal} className="w-full py-3 text-gray-500 font-black text-[10px] uppercase tracking-widest hover:bg-gray-50 rounded-lg flex items-center justify-center gap-2 transition-all border border-transparent hover:border-gray-200">
                <Eraser size={14} /> Limpar Terminal
              </button>
            )}
          </div>
        </div>

        {/* Lado Direito: Terminal */}
        <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden flex flex-col h-130 relative z-0">
          <div className="bg-brand-dark p-4 flex items-center justify-between border-b-4 border-brand-yellow">
            <h3 className="text-white font-bold text-xs tracking-widest uppercase flex items-center gap-2">
              <Clock size={16} className="text-brand-yellow" /> Monitor de Execução
            </h3>
            {status === 'processando' && (
              <span className="px-3 py-1 rounded-full text-[9px] font-black uppercase bg-green-500 text-white animate-pulse">
                Ao Vivo
              </span>
            )}
          </div>

          <div ref={terminalRef} className="bg-brand-terminal p-5 flex-1 overflow-y-auto font-mono text-[11px] shadow-inner custom-scrollbar scroll-smooth">
            {progresso.messages.length === 0 ? (
              <div className="text-gray-600 italic flex items-center justify-center h-full font-sans text-sm font-bold">Aguardando comando...</div>
            ) : (
              progresso.messages.map((msg: any, idx: number) => {
                const text = typeof msg === 'string' ? msg : JSON.stringify(msg);
                return (
                  <div key={idx} className={`mb-2 pb-2 border-b border-white/5 leading-relaxed ${text.includes('Erro') || text.includes('Falha') ? 'text-red-400' : text.includes('sucesso') ? 'text-green-400' : text.includes('Aviso') ? 'text-yellow-400' : 'text-gray-300'}`}>
                    <span className="text-gray-600 mr-2 opacity-50 font-bold">»</span> {text}
                  </div>
                );
              })
            )}
            {status === 'processando' && (
              <div className="text-brand-yellow animate-pulse mt-2 font-bold tracking-tighter">_ EXECUTANDO TAREFAS NA VM REMOTA...</div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>
      </div>
      <style>{`.custom-scrollbar::-webkit-scrollbar{width:6px}.custom-scrollbar::-webkit-scrollbar-thumb{background:#333;border-radius:10px}.custom-scrollbar::-webkit-scrollbar-track{background:#1a1a1a}`}</style>
    </div>
  );
};