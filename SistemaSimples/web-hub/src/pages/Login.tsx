import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { Eye, EyeOff } from "lucide-react";
import { User, Lock, Mail, UserPlus, ArrowRight, ArrowLeft } from 'lucide-react'; 

type AuthMode = 'login' | 'signup' | 'forgot';

export const Login: React.FC = () => {
  const [mode, setMode] = useState<AuthMode>('login');
  const [formData, setFormData] = useState({ name: '', email: '', username: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  // Classe utilitária para os inputs
  const inputClass = "w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-transparent rounded-xl outline-none focus:bg-white focus:border-gray-200 transition-all text-xs font-semibold placeholder:text-gray-300";

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (mode === 'login') {
        const params = new URLSearchParams();
        params.append('username', formData.username);
        params.append('password', formData.password);
        
        const { data } = await api.post('/auth/token', params, {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        login(data.access_token);
        navigate('/');
      } else if (mode === 'signup') {
        await api.post('/auth/signup', {
          username: formData.username,
          email: formData.email,
          password: formData.password,
          full_name: formData.name
        });
        alert("Usuário registrado com sucesso! Agora você pode fazer login.");
        setMode('login');
      } else {
        await api.post('/auth/forgot-password', { email: formData.email });
        alert("Link de recuperação enviado para " + formData.email);
        setMode('login');
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Erro ao processar solicitação.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 px-4 font-['Poppins']">
      <div className="flex w-full max-w-187.5 bg-white rounded-[25px] shadow-2xl overflow-hidden min-h-120">
        
        {/* LADO ESQUERDO: LOGO */}
        <div className="hidden md:flex flex-col items-center justify-center w-1/2 bg-brand-dark p-8 text-center border-r-8 border-brand-yellow">
          <img src="/static/img/scryta3.png" alt="SCRYTA Logo" className="w-full max-w-50 mb-6" />
          <div className="space-y-1">
            <h2 className="text-2xl font-bold text-white tracking-tight">Fiscal Core</h2>
            <p className="text-brand-yellow text-[10px] uppercase font-black tracking-[0.3em]">Inteligência Fiscal</p>
          </div>
          <div className="mt-auto text-[9px] text-gray-500 font-bold uppercase tracking-widest">SYS.V.2.0.26</div>
        </div>

        {/* LADO DIREITO: Form Dinâmico */}
        <div className="flex flex-col justify-center w-full md:w-1/2 p-10 bg-white">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-brand-dark mb-1 leading-tight">
              {mode === 'login' ? 'Bem-vindo' : mode === 'signup' ? 'Nova Conta' : 'Recuperar'}
            </h1>
            <p className="text-gray-500 text-xs font-medium">
              {mode === 'login' ? 'Acesse o painel de controle fiscal.' : mode === 'signup' ? 'Crie sua conta corporativa.' : 'Insira seu e-mail corporativo.'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <div className="bg-red-50 text-red-600 text-[10px] p-2 rounded-lg border border-red-100 font-bold text-center">{error}</div>}

            {mode === 'signup' && (
              <div className="space-y-1">
                <label className="text-[9px] uppercase font-black text-gray-500 ml-1 tracking-widest">Nome Completo</label>
                <div className="relative">
                  <UserPlus className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-300" size={16} />
                  <input name="name" type="text" className={inputClass} placeholder="Nome Completo" onChange={handleInputChange} required />
                </div>
              </div>
            )}

            {(mode === 'signup' || mode === 'forgot') && (
              <div className="space-y-1">
                <label className="text-[9px] uppercase font-black text-gray-500 ml-1 tracking-widest">E-mail Corporativo</label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-300" size={16} />
                  <input name="email" type="email" className={inputClass} placeholder="seu-email@scryta.com.br" onChange={handleInputChange} required />
                </div>
              </div>
            )}

            {mode !== 'forgot' && (
              <>
                <div className="space-y-1">
                  <label className="text-[9px] uppercase font-black text-gray-500 ml-1 tracking-widest">Usuário</label>
                  <div className="relative">
                    <User className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-300" size={16} />
                    <input name="username" type="text" className={inputClass} placeholder="usuario" onChange={handleInputChange} required />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] uppercase font-black text-gray-500 ml-1 tracking-widest">
                    Senha
                  </label>

                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-300" size={16} />

                    <input
                      name="password"
                      type={showPassword ? "text" : "password"}
                      value={formData.password}
                      onChange={handleInputChange}
                      className={inputClass}
                      placeholder="••••••••"
                      required
                    />

                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-600 transition"
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>                
              </>
            )}

            <button type="submit" disabled={loading} className="w-full bg-brand-yellow hover:bg-[#ffcb05] text-white py-3.5 rounded-xl font-black text-[11px] uppercase tracking-widest transition-all flex items-center justify-center gap-2 mt-2 shadow-lg shadow-yellow-500/10 active:scale-95">
              {loading ? 'Processando...' : mode === 'login' ? 'Entrar no Sistema' : mode === 'signup' ? 'Cadastrar Conta' : 'Enviar Link'}
              {!loading && <ArrowRight size={16} />}
            </button>

            {mode === 'login' && (
              <div className="text-center pt-1">
                <button type="button" onClick={() => setMode('forgot')} className="text-[10px] text-brand-yellow font-bold hover:underline">
                  Esqueci minha senha
                </button>
              </div>
            )}
          </form>

          {/* Rodapé Dinâmico */}
          <div className="mt-8 text-center border-t border-gray-100 pt-5">
            {mode === 'login' ? (
              <p className="text-[10px] text-gray-500 font-semibold">
                Novo por aqui? <button onClick={() => setMode('signup')} className="text-brand-yellow font-bold hover:underline">Crie sua conta</button>
              </p>
            ) : (
              <button onClick={() => setMode('login')} className="text-[10px] text-gray-500 font-bold flex items-center justify-center gap-1 mx-auto hover:text-brand-dark">
                <ArrowLeft size={12} /> Voltar para o Login
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};