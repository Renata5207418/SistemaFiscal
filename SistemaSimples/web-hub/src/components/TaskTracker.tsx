import { useEffect, useState } from 'react';
import api from '../services/api';
import { Play, AlertCircle, CheckCircle2, Clock } from 'lucide-react';

export function TaskTracker() {
  const [tasks, setTasks] = useState([]);

  const fetchTasks = async () => {
    // Chama sua nova rota v2
    const { data } = await api.get('/v2/fila/tarefas');
    setTasks(data.data);
  };

  useEffect(() => {
    fetchTasks();
    const interval = setInterval(fetchTasks, 5000); // Atualiza a cada 5s
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="p-6 bg-white rounded-lg shadow-sm border border-gray-200">
      <h2 className="text-xl font-bold text-brand-dark mb-4 flex items-center gap-2">
        <Play size={20} /> Monitor de Tarefas em Tempo Real
      </h2>
      
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead className="bg-brand-dark text-white text-sm">
            <tr>
              <th className="p-3 rounded-l-lg">Cliente</th>
              <th className="p-3">Tipo</th>
              <th className="p-3">Status</th>
              <th className="p-3 rounded-r-lg">Duração/Erro</th>
            </tr>
          </thead>
          <tbody className="text-sm">
            {tasks.map((task: any) => (
              <tr key={task.id} className="border-bottom border-gray-100 hover:bg-gray-50 transition-colors">
                <td className="p-3 font-medium text-brand-muted">{task.cliente_cod}</td>
                <td className="p-3">{task.tipo}</td>
                <td className="p-3">
                  <span className={`flex items-center gap-1 font-bold ${
                    task.status === 'CONCLUIDO' ? 'text-green-600' : 
                    task.status === 'ERRO' ? 'text-red-600' : 'text-amber-600'
                  }`}>
                    {task.status === 'CONCLUIDO' && <CheckCircle2 size={16} />}
                    {task.status === 'ERRO' && <AlertCircle size={16} />}
                    {task.status === 'PENDENTE' && <Clock size={16} />}
                    {task.status}
                  </span>
                </td>
                <td className="p-3 text-gray-500">
                  {task.error_msg || '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
