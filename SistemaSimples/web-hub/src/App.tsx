import React from 'react'; 
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Login } from './pages/Login';
import { ResetPassword } from './pages/ResetPassword';
import { Clientes } from './pages/Clientes';
import { Layout } from './components/Layout';
import { SimplesNacional } from './pages/SimplesNacional';
import { RegimeNormal } from './pages/RegimeNormal';
import { BuscaXML } from './pages/BuscaXML';
import { ApuracaoRPA } from './pages/ApuracaoRPA';  
import { Dashboard } from './pages/Dashboard';
import { FatorR } from './pages/FatorR';
import { TomadasNfse } from './pages/TomadasNfse';
import { Usuarios } from './pages/Usuarios';

const PrivateRoute = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? children : <Navigate to="/login" />;
};

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* ROTAS PÚBLICAS  */}
          <Route path="/login" element={<Login />} />
          <Route path="/reset-password" element={<ResetPassword />} /> 

          {/* ROTAS PRIVADAS */}
          <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
            <Route index element={<Dashboard />} />
            <Route path="rpa-apuracao" element={<ApuracaoRPA />} />
            <Route path="simples-nacional" element={<SimplesNacional />} />
            <Route path="clientes" element={<Clientes />} />
            <Route path="tarefas" element={<BuscaXML />} />
            <Route path="regime-normal" element={<RegimeNormal />} />      
            <Route path="fator-r" element={<FatorR />} />      
            <Route path="tomadas" element={<TomadasNfse />} />
            <Route path="/usuarios" element={<Usuarios />} />
          </Route>

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;