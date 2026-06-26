import { Link, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { LayoutDashboard, Users, Search, DollarSign, LogOut, Bot, Percent, FileText, Shield } from 'lucide-react';

export const Layout = () => {
  const { user, logout } = useAuth();
  const location = useLocation();

  const menuItems = [
    { path: '/', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/clientes', label: 'Clientes', icon: Users },
    { path: '/tarefas', label: 'Busca XML', icon: Search },
    { path: '/simples-nacional', label: 'Simples Nacional', icon: DollarSign },
    { path: '/regime-normal', label: 'Regime Normal', icon: DollarSign },
    { path: '/fator-r', label: 'Fator R', icon: Percent }, 
    { path: '/tomadas', label: 'Tomadas', icon: FileText },
    { path: '/rpa-apuracao', label: 'Apuração RPA', icon: Bot }, 
    ...(user?.is_admin ? [{ path: '/usuarios', label: 'Gestão de Usuários', icon: Shield }] : []),
  ];

  const initial = user?.full_name ? user.full_name.charAt(0).toUpperCase() : 'U';
  const displayName = user?.full_name || user?.username || 'Usuário';

  return (
    <div className="flex h-screen bg-[#f1f5f9] font-['Poppins']">
      
      {/* SIDEBAR RETRÁTIL INTELIGENTE */}
      <aside className="group w-16 hover:w-60 bg-brand-dark text-white flex flex-col shadow-2xl transition-all duration-300 ease-in-out z-20 relative h-full overflow-hidden rounded-tr-md rounded-br-md">
        
        {/* LOGO */}
        <div className="h-14 flex items-center justify-center border-b border-gray-600/50 shrink-0 transition-all duration-300">
          <img src="/static/img/logoscryta.png" alt="Icon" className="h-7 w-7 object-contain group-hover:hidden transition-all duration-300" />
          <img src="/static/img/scryta.png" alt="Logo" className="h-8 w-auto object-contain hidden group-hover:block transition-all duration-300" style={{ maxWidth: '120px' }} />
        </div>

        {/* MENU */}
        <nav className="flex-1 px-2 py-4 space-y-2 overflow-y-auto scrollbar-hide">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                title={item.label}
                className={`flex items-center h-11 rounded-xl text-[13px] transition-all overflow-hidden ${
                  isActive ? 'bg-[#4a4a4a] text-white shadow-inner' : 'hover:bg-[#4a4a4a] text-gray-300 hover:text-white'
                }`}
              >
                {/* Contêiner fixo para forçar a centralização perfeita do ícone */}
                <div className="w-12 h-full flex items-center justify-center shrink-0">
                  <Icon size={20} className={`transition-transform ${isActive ? 'text-brand-yellow' : 'text-gray-400'}`} />
                </div>
                <span className="whitespace-nowrap font-medium opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                  {item.label}
                </span>
              </Link>
            );
          })}
        </nav>

        {/* LOGOUT */}
        <div className="px-2 pb-4">
          <button 
            onClick={logout}
            title="Sair do Sistema"
            className="w-full flex items-center h-11 rounded-xl hover:bg-red-500/10 text-gray-400 hover:text-red-400 transition-all border border-transparent hover:border-red-500/20 text-sm font-medium overflow-hidden"
          >
            <div className="w-12 h-full flex items-center justify-center shrink-0">
              <LogOut size={20} /> 
            </div>
            <span className="whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-300">
              Sair do Sistema
            </span>
          </button>
        </div>
      </aside>

      {/* ÁREA CENTRAL */}
      <main className="flex-1 flex flex-col overflow-hidden relative bg-[#f8f9fa]">
        
        {/* HEADER INVISÍVEL COM PÍLULA DO USUÁRIO */}
        <header className="h-14 flex items-end px-10 justify-end z-10 shrink-0">   
          <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-full shadow-sm border border-gray-200 hover:shadow-md transition-shadow">
            <div className="text-right hidden sm:block">
              <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide leading-tight px-1">
                {displayName}
              </p>              
            </div>

            <div className="relative group">
              <div className="w-7 h-7 rounded-full bg-brand-yellow flex items-center justify-center text-white font-bold text-xs shadow-sm cursor-pointer">
                {initial}
              </div>
              {/* Indicador Online reduzido */}
              <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 border-2 border-white rounded-full"></span>
            </div>
          </div>
        </header>

        {/* CONTEÚDO DAS PÁGINAS (Ajustado p-10 para pt-4 para compensar o header novo) */}
        <div className="flex-1 overflow-auto px-10 pb-10 pt-4">
          <Outlet /> 
        </div>
      </main>

      <style>{`.scrollbar-hide::-webkit-scrollbar { display: none; }`}</style>
    </div>
  );
};