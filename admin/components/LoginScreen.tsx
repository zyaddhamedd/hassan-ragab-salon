
import React, { useState } from 'react';
import { Lock, User, ShieldCheck } from 'lucide-react';
import Logo from './Logo.tsx';
import { login, saveAuthData } from '../api/auth';

interface LoginScreenProps {
  onLogin: () => void;
  isDarkMode: boolean;
}

const LoginScreen: React.FC<LoginScreenProps> = ({ onLogin, isDarkMode }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      // Call backend login API
      const response = await login({ username, password });

      // Save token and user data
      saveAuthData(response.access_token, response.user, response.refresh_token);

      // Trigger authenticated state
      onLogin();
    } catch (err: any) {
      // Handle login errors
      const errorMessage = err.response?.data?.error || 'فشل تسجيل الدخول. تحقق من البيانات.';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`h-screen flex flex-col items-center justify-center p-4 sm:p-6 relative overflow-hidden font-['Tajawal'] theme-transition ${isDarkMode ? 'bg-[#000000]' : 'bg-[#F7F7F7]'
      }`} dir="rtl">

      {/* Background Subtle Gradient */}
      <div className={`absolute inset-0 opacity-10 pointer-events-none ${isDarkMode
        ? 'bg-gradient-to-b from-[#121212] via-black to-[#050505]'
        : 'bg-gradient-to-b from-white via-[#F9F9F9] to-gray-100'
        }`}></div>

      <div className="relative z-10 w-full max-w-md flex flex-col items-center">

        {/* Logo Section - Clean and Centered */}
        <div className="relative mb-2 sm:mb-3 flex items-center justify-center animate-fade-in shrink-0">
          <Logo size="hero" />
        </div>

        {/* Title Text Below Logo */}
        <div className="text-center mb-6 flex flex-col items-center animate-fade-in-up shrink-0">
          <h1 className={`text-2xl sm:text-3xl font-bold leading-tight tracking-tight ${isDarkMode ? 'text-white' : 'text-[#121212]'}`}>
            نادي الرجال السري
          </h1>
          <div className="h-[1px] w-16 sm:w-20 bg-gradient-to-r from-transparent via-[#E53935] to-transparent mx-auto mt-2 opacity-60"></div>
        </div>

        {/* Login Form Container */}
        <div className={`w-full border rounded-2xl p-6 sm:p-8 border-t-[#E53935]/20 theme-transition shrink-0 ${isDarkMode ? 'bg-[#161616] border-white/5 shadow-[0_50px_100px_rgba(0,0,0,0.9)]' : 'bg-white border-black/5 shadow-2xl'
          }`}>
          <div className="flex items-center justify-center gap-3 mb-6 sm:mb-8 opacity-40">
            <div className={`h-[1px] w-8 sm:w-10 ${isDarkMode ? 'bg-white/20' : 'bg-black/20'}`}></div>
            <span className={`text-[9px] sm:text-[10px] font-bold uppercase tracking-[0.4em] ${isDarkMode ? 'text-white' : 'text-black'}`}>تحقق الهوية</span>
            <div className={`h-[1px] w-8 sm:w-10 ${isDarkMode ? 'bg-white/20' : 'bg-black/20'}`}></div>
          </div>

          <form onSubmit={handleLogin} className="space-y-4 sm:space-y-5">
            <div className="space-y-1.5">
              <label className={`text-[9px] sm:text-[10px] font-bold uppercase tracking-widest mr-1 ${isDarkMode ? 'text-[#7A7A7A]' : 'text-gray-400'}`}>معرف القائد</label>
              <div className="relative group">
                <User size={16} className={`absolute right-4 top-1/2 -translate-y-1/2 transition-colors ${isDarkMode ? 'text-[#7A7A7A] group-focus-within:text-[#E53935]' : 'text-gray-400 group-focus-within:text-[#E53935]'}`} />
                <input
                  type="text"
                  placeholder="EXECUTIVE ID"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className={`w-full border rounded-lg py-3.5 sm:py-4 pr-11 sm:pr-12 pl-4 text-xs sm:text-sm outline-none transition-all font-bold tracking-widest ${isDarkMode ? 'bg-[#0B0B0B] border-white/5 text-white focus:border-[#E53935]/40 placeholder:text-white/10' : 'bg-gray-50 border-gray-200 text-[#121212] focus:border-[#E53935]/40 placeholder:text-gray-300'
                    }`}
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className={`text-[9px] sm:text-[10px] font-bold uppercase tracking-widest mr-1 ${isDarkMode ? 'text-[#7A7A7A]' : 'text-gray-400'}`}>المفتاح الأمني</label>
              <div className="relative group">
                <Lock size={16} className={`absolute right-4 top-1/2 -translate-y-1/2 transition-colors ${isDarkMode ? 'text-[#7A7A7A] group-focus-within:text-[#E53935]' : 'text-gray-400 group-focus-within:text-[#E53935]'}`} />
                <input
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`w-full border rounded-lg py-3.5 sm:py-4 pr-11 sm:pr-12 pl-4 text-xs sm:text-sm outline-none transition-all font-bold tracking-widest ${isDarkMode ? 'bg-[#0B0B0B] border-white/5 text-white focus:border-[#E53935]/40' : 'bg-gray-50 border-gray-200 text-[#121212] focus:border-[#E53935]/40'
                    }`}
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#E53935] hover:bg-[#FF3B30] text-white py-3 sm:py-3.5 rounded-lg font-bold text-xs sm:text-sm tracking-widest shadow-2xl shadow-red-900/40 active:scale-[0.98] transition-all flex items-center justify-center gap-3 sm:gap-4 mt-1 sm:mt-2 uppercase group"
            >
              {loading ? (
                <div className="h-5 w-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
              ) : (
                <>
                  <span className="group-hover:tracking-[0.1em] transition-all">دخول النظام</span>
                  <ShieldCheck size={18} />
                </>
              )}
            </button>

            {/* Error Message */}
            {error && (
              <div className={`mt-4 p-3 rounded-lg border text-center ${isDarkMode ? 'bg-red-900/10 border-red-500/20 text-red-400' : 'bg-red-50 border-red-200 text-red-600'}`}>
                <p className="text-xs sm:text-sm font-bold">{error}</p>
              </div>
            )}
          </form>
        </div>

        <div className="mt-6 sm:mt-8 text-center opacity-30 shrink-0">
          <p className={`text-[9px] sm:text-[10px] font-bold uppercase tracking-[0.5em] sm:tracking-[0.6em] ${isDarkMode ? 'text-[#7A7A7A]' : 'text-gray-400'}`}>
            EXECUTIVE TERMINAL • 2025
          </p>
        </div>
      </div>
    </div>
  );
};

export default LoginScreen;
