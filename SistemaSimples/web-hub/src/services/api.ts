import axios from 'axios';

const api = axios.create({
  baseURL: 'http://10.0.0.172:8001/api',  // alterar na mudança de máquinas
});

api.interceptors.request.use((config) => {
  // Busca a chave correta salva pelo AuthContext
  const token = localStorage.getItem('access_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// INTERCEPTOR DE RESPOSTA (O "vigia" da sessão)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // Se o servidor retornar 401 (Sessão expirada ou Token inválido)
    if (error.response && error.response.status === 401) {
      // Limpa as chaves exatas para evitar conflitos de sessão
      localStorage.removeItem('access_token'); 
      localStorage.removeItem('user');
      
      // Força o redirecionamento imediato para a tela de login
      window.location.href = '/login'; 
    }
    return Promise.reject(error);
  }
);

export default api;