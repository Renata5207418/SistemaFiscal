import React, { useState, useRef, useEffect } from 'react';
import api from '../services/api';
// Adicionado Eye e EyeOff para a senha
import { Upload, X, AlertCircle, CheckCircle, ChevronDown, Search, Eye, EyeOff } from 'lucide-react';

interface AddCertificateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  clientes: { cod: number; empresa: string; cnpj: string }[];
}

export const AddCertificateModal: React.FC<AddCertificateModalProps> = ({ isOpen, onClose, onSuccess, clientes }) => {
  const [selectedCliente, setSelectedCliente] = useState('');
  const [selectedClienteNome, setSelectedClienteNome] = useState('');
  const [password, setPassword] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  
  // Estados novos para controle de UI
  const [showPassword, setShowPassword] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  // LIMPEZA AUTOMÁTICA: Sempre que o modal abrir, limpa os estados anteriores
  useEffect(() => {
    if (isOpen) {
      setFile(null);
      setSelectedCliente('');
      setSelectedClienteNome('');
      setPassword('');
      setError('');
      setSuccess(false); // Resolve o problema de aparecer a mensagem de sucesso anterior
      setSearchTerm('');
      setIsDropdownOpen(false);
      setShowPassword(false);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    if (!selectedCliente || !file || !password) {
      setError('Por favor, preencha todos os campos e anexe o arquivo.');
      return;
    }

    setLoading(true);
    const formData = new FormData();
    const codCliente = selectedClienteNome.split(' - ')[0];

    formData.append('file', file);
    formData.append('password', password); 
    formData.append('cod_cliente', codCliente); 

    try {
      await api.post('/certificados/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setSuccess(true);
      
      setTimeout(() => {
        onSuccess();
        onClose(); // Aqui o onClose vai disparar o reset no useEffect acima quando abrir de novo
      }, 2000);
      
    } catch (err: any) {
      const msg = err.response?.data?.detail;
      setError(typeof msg === 'string' ? msg : 'Erro ao processar certificado. Verifique a senha.');
    } finally {
      setLoading(false);
    }
  };

  const filteredClientes = clientes.filter(c => 
    `${c.cod} ${c.empresa}`.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const inputClass = "w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-semibold outline-none focus:bg-white focus:border-[#044780] transition-all text-brand-dark";

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 font-['Poppins']">
      <div className="bg-white rounded-[25px] shadow-2xl w-full max-w-xl overflow-hidden flex flex-col border border-gray-100 transition-all">
        
        <div className="bg-brand-dark px-8 py-5 flex items-center justify-between border-b-4 border-brand-blue">
          <h2 className="text-white font-bold text-lg tracking-tight">Adicionar Certificado</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X size={22} />
          </button>
        </div>

        <div className="p-8">
          {success ? (
            <div className="flex flex-col items-center justify-center py-10 text-center space-y-4">
              <CheckCircle size={48} className="text-green-500" />
              <h3 className="font-bold text-xl text-brand-dark">Upload Concluído!</h3>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              {error && (
                <div className="bg-red-50 text-red-600 text-[11px] p-4 rounded-xl border border-red-100 flex items-start gap-3 font-bold">
                  <AlertCircle size={18} className="shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div className="space-y-2 relative" ref={dropdownRef}>
                <label className="text-[10px] uppercase font-black text-gray-400 ml-1 tracking-widest">Empresa</label>
                
                <div 
                  onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                  className={`${inputClass} cursor-pointer flex items-center justify-between group overflow-hidden`}
                >
                  <span className={`truncate ${!selectedClienteNome ? 'text-gray-400' : ''}`}>
                    {selectedClienteNome || "Clique para buscar..."}
                  </span>
                  <ChevronDown size={18} className={`transition-transform duration-300 ${isDropdownOpen ? 'rotate-180 text-brand-blue' : 'text-gray-400'}`} />
                </div>

                {isDropdownOpen && (
                  <div className="absolute top-full left-0 w-full mt-2 bg-white border border-gray-200 rounded-2xl shadow-2xl z-60 overflow-hidden">
                    <div className="p-3 border-b border-gray-100 bg-gray-50 flex items-center gap-2">
                      <Search size={16} className="text-gray-400" />
                      <input 
                        type="text"
                        placeholder="Pesquisar empresa..."
                        className="bg-transparent w-full text-sm outline-none font-semibold text-brand-dark"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        autoFocus
                      />
                    </div>
                    
                    <div className="max-h-60 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-200">
                      {filteredClientes.length > 0 ? (
                        filteredClientes.map(c => (
                          <div 
                            key={c.cod}
                            onClick={() => {
                              setSelectedCliente(c.cnpj);
                              setSelectedClienteNome(`${c.cod} - ${c.empresa}`);
                              setIsDropdownOpen(false);
                            }}
                            className="px-4 py-3 text-sm font-semibold text-brand-dark hover:bg-brand-blue hover:text-white cursor-pointer transition-colors flex flex-col gap-0.5"
                          >
                            <span className="text-[10px] opacity-70">CÓD: {c.cod}</span>
                            <span className="truncate">{c.empresa}</span>
                          </div>
                        ))
                      ) : (
                        <div className="px-4 py-8 text-center text-gray-400 text-sm">
                          Nenhuma empresa encontrada.
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* CAMPO DE SENHA COM OLHINHO */}
              <div className="space-y-2">
                <label className="text-[10px] uppercase font-black text-gray-400 ml-1 tracking-widest">Senha do Certificado</label>
                <div className="relative">
                  <input 
                    type={showPassword ? "text" : "password"} 
                    placeholder="Senha do .pfx"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={inputClass}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-brand-blue transition-colors focus:outline-none"
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] uppercase font-black text-gray-400 ml-1 tracking-widest">Arquivo (.PFX)</label>
                <div className="border-2 border-dashed border-gray-200 rounded-[20px] p-10 text-center hover:bg-gray-50 hover:border-brand-blue/40 transition-all relative cursor-pointer">
                  <input type="file" accept=".pfx" onChange={handleFileChange} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                  <div className="flex flex-col items-center gap-3">
                    <Upload size={32} className={file ? "text-brand-blue" : "text-gray-300"} />
                    <span className="text-sm font-bold text-brand-dark truncate px-4 w-full">
                      {file ? file.name : "Clique para selecionar"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="pt-6 flex gap-4">
                <button type="button" onClick={onClose} className="flex-1 px-6 py-4 bg-gray-50 text-gray-400 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-gray-100 transition-all">Cancelar</button>
                <button type="submit" disabled={loading} className="flex-1 px-6 py-4 bg-brand-dark text-white rounded-2xl font-black text-[10px] uppercase tracking-widest hover:text-brand-blue transition-all shadow-xl disabled:opacity-50">
                  {loading ? 'Enviando...' : 'Salvar Dados'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};