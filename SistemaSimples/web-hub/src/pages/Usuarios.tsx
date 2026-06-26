import React, { useEffect, useState, useMemo } from 'react';
import api from '../services/api';
import { 
  UserPlus, Search, Pencil, ShieldCheck, ShieldAlert, 
  X, Save, AlertCircle, Shield, CheckCircle
} from 'lucide-react';

interface Usuario {
  id: string;
  username: string;
  email: string;
  full_name: string;
  is_active: boolean;
  is_admin: boolean;
  created_at?: string;
  updated_at?: string;
}

export const Usuarios: React.FC = () => {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modoEdicao, setModoEdicao] = useState(false);
  
  const [formData, setFormData] = useState({
    id: '',
    username: '',
    email: '',
    full_name: '',
    is_active: true,
    is_admin: false
  });

  const [alertModal, setAlertModal] = useState<{ isOpen: boolean; message: string; type: 'success' | 'error' }>({ 
    isOpen: false, message: '', type: 'success' 
  });

  const fetchUsuarios = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/usuarios');
      setUsuarios(data.usuarios || []);
    } catch (err: any) {
      console.error("Erro ao carregar usuários:", err);
      if (err.response?.status === 403) {
        setAlertModal({ isOpen: true, message: "Acesso negado. Apenas administradores podem ver esta tela.", type: 'error' });
      } else {
        setAlertModal({ isOpen: true, message: "Erro ao carregar a lista de usuários.", type: 'error' });
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchUsuarios(); }, []);

  const abrirModalNovo = () => {
    setModoEdicao(false);
    setFormData({ id: '', username: '', email: '', full_name: '', is_active: true, is_admin: false });
    setIsModalOpen(true);
  };

  const abrirModalEditar = (u: Usuario) => {
    setModoEdicao(true);
    setFormData({ 
      id: u.id, username: u.username, email: u.email, full_name: u.full_name || '', is_active: u.is_active, is_admin: u.is_admin 
    });
    setIsModalOpen(true);
  };

  const handleSalvar = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const payload = {
        username: formData.username,
        email: formData.email,
        full_name: formData.full_name,
        is_active: formData.is_active,
        is_admin: formData.is_admin
      };

      if (modoEdicao) {
        await api.put(`/usuarios/${formData.id}`, payload);
        setAlertModal({ isOpen: true, message: "Usuário atualizado com sucesso!", type: 'success' });
      } else {
        await api.post('/usuarios', payload);
        setAlertModal({ isOpen: true, message: "Usuário criado com sucesso!", type: 'success' });
      }
      
      setIsModalOpen(false);
      fetchUsuarios();
      
    } catch (err: any) {
      let msg = "Erro ao salvar usuário.";
      if (err.response?.data?.detail) {
        msg = typeof err.response.data.detail === 'string' 
              ? err.response.data.detail 
              : err.response.data.detail[0]?.msg || msg;
      }
      setAlertModal({ isOpen: true, message: msg, type: 'error' });
    }
  };

  const usuariosFiltrados = useMemo(() => {
    const termo = busca.toLowerCase();
    return usuarios.filter(u => 
      u.username.toLowerCase().includes(termo) || 
      u.email.toLowerCase().includes(termo) || 
      (u.full_name && u.full_name.toLowerCase().includes(termo))
    );
  }, [usuarios, busca]);

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  const inputClass = "w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-semibold outline-none focus:bg-white focus:border-brand-yellow transition-all text-brand-dark";

  return (
    <div className="space-y-6 font-['Poppins'] pb-10">
      
      {/* CABEÇALHO */}
      <div className="mb-8 flex items-center justify-between px-2">
        <div className="flex items-center gap-5">
          <div className="w-14 h-14 bg-brand-yellow/10 rounded-2xl flex items-center justify-center shrink-0 text-brand-yellow">
            <Shield size={28} />
          </div>
          <div className="space-y-0.5">
            <h1 className="text-2xl font-bold text-brand-dark tracking-tight">Gestão de <span className="text-brand-yellow font-medium">Usuários</span></h1>
            <p className="text-[13px] text-gray-500 font-medium">Controle de acessos, perfis e permissões do sistema.</p>
          </div>
        </div>
      </div>

      {/* BARRA DE FERRAMENTAS */}
      <div className="flex flex-wrap lg:flex-nowrap gap-4 items-center justify-between bg-white p-5 rounded-xl shadow-sm border border-gray-100">
        {/*CRIAR NOVO USUARIO SEM CAMPO DE SENHA
        <div className="flex gap-3">
          <button onClick={abrirModalNovo} className="flex items-center gap-2 bg-brand-dark text-white px-5 py-2.5 rounded-lg font-black text-[10px] uppercase tracking-widest hover:text-brand-yellow transition-all shadow-sm">
            <UserPlus size={16} /> Novo Usuário
          </button>
        </div>*/}

        <div className="relative shrink-0">
          <Search className="absolute left-3.5 top-2.5 text-gray-500" size={16} />
          <input 
            type="text" 
            placeholder="Buscar por nome, username ou email..." 
            value={busca} 
            onChange={e => setBusca(e.target.value)} 
            className="pl-10 pr-4 py-2.5 bg-gray-50 border border-transparent rounded-lg text-xs font-bold outline-none focus:bg-white focus:border-gray-200 w-full sm:w-80 text-brand-dark transition-all" 
          />
        </div>
      </div>

      {/* TABELA */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden relative z-0">
        <div className="overflow-x-auto custom-scrollbar pb-6 min-h-87.5">
          <table className="w-full text-left text-sm">
            <thead className="bg-brand-panel border-b border-gray-200">
              <tr>
                <th className="p-3 text-left font-black uppercase text-[10px] tracking-widest text-gray-500">Usuário</th>
                <th className="p-3 text-left font-black uppercase text-[10px] tracking-widest text-gray-500">E-mail</th>
                <th className="p-3 text-center font-black uppercase text-[10px] tracking-widest text-gray-500">Status</th>
                <th className="p-3 text-center font-black uppercase text-[10px] tracking-widest text-gray-500">Perfil</th>
                <th className="p-3 text-center font-black uppercase text-[10px] tracking-widest text-gray-500">Criado em</th>
                <th className="p-3 text-center font-black uppercase text-[10px] tracking-widest text-gray-500 sticky right-0 bg-brand-panel z-10 w-20 border-l border-gray-50">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                <tr><td colSpan={6} className="p-12 text-center text-gray-300 italic animate-pulse font-bold">Carregando usuários...</td></tr>
              ) : usuariosFiltrados.length === 0 ? (
                <tr><td colSpan={6} className="p-12 text-center text-gray-500 font-bold">Nenhum usuário encontrado.</td></tr>
              ) : usuariosFiltrados.map(u => (
                <tr key={u.id} className={`hover:bg-gray-50/80 transition-colors group ${!u.is_active ? 'opacity-50' : ''}`}>
                  
                  <td className="p-3 align-top">
                    <div className="flex flex-col gap-0.5">
                      <div className="font-bold text-brand-dark flex items-center gap-2">
                        <span className={!u.is_active ? 'line-through text-gray-500' : ''}>{u.full_name || 'Sem Nome'}</span>
                        {!u.is_active && (
                           <span className="bg-red-50 text-red-500 border border-red-100 px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-tight">Inativo</span>
                        )}
                      </div>
                      <div className="text-[10px] font-bold text-brand-yellow font-mono tracking-tighter">@{u.username}</div>
                    </div>
                  </td>

                  <td className="p-3 align-top">
                    <span className="font-medium text-gray-600 text-sm">{u.email}</span>
                  </td>

                  <td className="p-3 align-top text-center">
                    {u.is_active ? (
                      <span className="text-green-600 flex items-center justify-center gap-1.5 font-black text-[9px] uppercase mt-1">
                        <ShieldCheck size={12}/> Ativo
                      </span>
                    ) : (
                      <span className="text-red-400 flex items-center justify-center gap-1.5 font-black text-[9px] uppercase mt-1">
                        <ShieldAlert size={12}/> Inativo
                      </span>
                    )}
                  </td>

                  <td className="p-3 align-top text-center">
                    <span className={`px-2 py-1 inline-block rounded-md text-[9px] font-black uppercase border mt-1 ${
                      u.is_admin ? 'bg-brand-dark text-brand-yellow border-gray-700' : 'bg-blue-50 text-blue-600 border-blue-100'
                    }`}>
                      {u.is_admin ? 'Administrador' : 'Usuário Padrão'}
                    </span>
                  </td>

                  <td className="p-3 align-top text-center">
                    <span className="font-medium text-gray-500 text-xs mt-1 block">{formatDate(u.created_at)}</span>
                  </td>

                  <td className="p-3 align-middle text-center sticky right-0 bg-white group-hover:bg-gray-50/80 shadow-[-4px_0_10px_rgba(0,0,0,0.02)] transition-colors border-l border-transparent z-10 w-20">
                    <button onClick={() => abrirModalEditar(u)} className="p-2 text-gray-500 hover:text-brand-yellow hover:bg-gray-100 rounded-lg transition-all" title="Editar Usuário">
                      <Pencil size={18} className="mx-auto" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL DE CADASTRO/EDIÇÃO */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[25px] shadow-2xl w-full max-w-lg overflow-hidden flex flex-col border border-gray-100">
            <div className="bg-brand-dark px-8 py-5 flex items-center justify-between border-b-4 border-brand-yellow">
              <h2 className="text-white font-bold uppercase tracking-widest text-xs">
                {modoEdicao ? 'Editar Usuário' : 'Novo Usuário'}
              </h2>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-500 hover:text-white transition-all"><X size={22} /></button>
            </div>
            
            <form onSubmit={handleSalvar} className="p-8 space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-black text-gray-500 ml-1">Username (Login)*</label>
                  <input type="text" value={formData.username} onChange={e => setFormData({...formData, username: e.target.value})} className={inputClass} placeholder="Ex: kailane" required />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-black text-gray-500 ml-1">Nome Completo</label>
                  <input type="text" value={formData.full_name} onChange={e => setFormData({...formData, full_name: e.target.value})} className={inputClass} placeholder="Ex: Kailane DCC" />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] uppercase font-black text-gray-500 ml-1">E-mail*</label>
                <input type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} className={inputClass} placeholder="email@scryta.com.br" required />
              </div>

              <div className="grid grid-cols-2 gap-4 pt-2">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-black text-gray-500 ml-1">Acesso do Usuário</label>
                  <div className="flex items-center h-11.5 px-4 bg-gray-50 border border-gray-200 rounded-xl cursor-pointer hover:bg-gray-100 transition-colors" onClick={() => setFormData({...formData, is_active: !formData.is_active})}>
                    <label className="flex items-center justify-between w-full cursor-pointer">
                        <span className={`text-[11px] font-black uppercase tracking-tighter ${formData.is_active ? 'text-green-600' : 'text-gray-500'}`}>
                          {formData.is_active ? 'Ativo' : 'Inativo'}
                        </span>
                        <input type="checkbox" checked={formData.is_active} readOnly style={{ accentColor: '#10b981' }} className="w-4 h-4 cursor-pointer" />
                    </label>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-black text-brand-dark ml-1">Privilégios Administrativos</label>
                  <div className="flex items-center h-11.5 px-4 bg-gray-50 border border-gray-200 rounded-xl cursor-pointer hover:bg-gray-100 transition-colors" onClick={() => setFormData({...formData, is_admin: !formData.is_admin})}>
                    <label className="flex items-center justify-between w-full cursor-pointer">
                        <span className={`text-[11px] font-black uppercase tracking-tighter ${formData.is_admin ? 'text-brand-yellow' : 'text-gray-500'}`}>
                          {formData.is_admin ? 'Admin' : 'Padrão'}
                        </span>
                        <input type="checkbox" checked={formData.is_admin} readOnly style={{ accentColor: '#fdb913' }} className="w-4 h-4 cursor-pointer" />
                    </label>
                  </div>
                </div>
              </div>

              <div className="pt-4 flex gap-4">
                <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 px-6 py-4 bg-gray-50 text-gray-500 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-gray-100 transition-all">Cancelar</button>
                <button type="submit" className="flex-1 px-6 py-4 bg-brand-dark text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:text-brand-yellow transition-all shadow-xl flex items-center justify-center gap-2">
                  <Save size={16}/> {modoEdicao ? 'Salvar Alterações' : 'Criar Usuário'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL DE ALERTA/SUCESSO */}
      {alertModal.isOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-70 p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-[25px] shadow-2xl w-full max-w-sm overflow-hidden flex flex-col border border-gray-100">
            <div className="bg-brand-dark px-6 py-4 flex items-center justify-between border-b-4 border-brand-yellow">
              <div className="flex items-center gap-2 text-white">
                {alertModal.type === 'error' ? <AlertCircle size={20} className="text-red-400" /> : <CheckCircle size={20} className="text-green-400" />}
                <h2 className="font-bold text-lg tracking-tight">{alertModal.type === 'error' ? 'Atenção' : 'Sucesso'}</h2>
              </div>
              <button onClick={() => setAlertModal({ ...alertModal, isOpen: false })} className="text-gray-500 hover:text-white transition-colors"><X size={22} /></button>
            </div>
            <div className="p-8 text-center flex flex-col items-center">
              <p className="text-brand-dark text-sm font-bold leading-relaxed mb-6">{alertModal.message}</p>
              <button onClick={() => setAlertModal({ ...alertModal, isOpen: false })} className="w-full px-4 py-3 bg-brand-dark text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:text-brand-yellow transition-all shadow-md">
                Entendi
              </button>
            </div>
          </div>
        </div>
      )}
      
      <style>{`.custom-scrollbar::-webkit-scrollbar{width:4px}.custom-scrollbar::-webkit-scrollbar-track{background:#f1f1f1;border-radius:4px}.custom-scrollbar::-webkit-scrollbar-thumb{background:#d1d5db;border-radius:4px}`}</style>
    </div>
  );
};