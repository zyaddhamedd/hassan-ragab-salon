import React, { useState } from 'react';
import { User, Lock } from 'lucide-react';
import {
  apiClient,
  DEVICE_ID,
  finalizeDeviceEnrollment,
  MiniDeviceContext,
  prepareLoginDeviceProof,
} from '../src/api/client';
import Logo from './Logo';

interface Cashier {
  id: number;
  name: string;
  email: string;
  branch_id: number;
  branch_name: string;
}

interface LoginScreenProps {
  onLogin: (data: { cashier: Cashier, token?: string, access_token?: string, refresh_token?: string, device_context?: MiniDeviceContext | null }) => void;
  externalError?: string | null;
}

type LoginErrorState = {
  message: string;
  code?: string;
  pairingCode?: string;
  expiresAt?: string;
  limitReached?: boolean;
  pendingEnrollmentId?: number;
};

const LoginScreen: React.FC<LoginScreenProps> = ({ onLogin, externalError = null }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<LoginErrorState | null>(null);

  const isUnauthorizedDeviceError =
    error?.code === 'DEVICE_NOT_AUTHORIZED' ||
    error?.message === 'Unauthorized Device' ||
    error?.message === 'DEVICE_NOT_AUTHORIZED' ||
    error?.message.includes('unauthorized device') ||
    error?.message.includes('غير مصرح') ||
    error?.message.includes('غير متصل');

  const isEnrollmentRequired = error?.code === 'DEVICE_ENROLLMENT_REQUIRED';
  const isFinalizationRequired = error?.code === 'DEVICE_FINALIZATION_REQUIRED';
  const isProofRepairRequired =
    error?.code === 'DEVICE_PROOF_KEY_MISSING' ||
    error?.code === 'DEVICE_PROOF_KEY_MISMATCH' ||
    error?.code === 'DEVICE_PROOF_STORAGE_UNAVAILABLE' ||
    error?.code === 'DEVICE_PROOF_REPAIR_REQUIRED';

  const login = async () => {
    const deviceProof = await prepareLoginDeviceProof();
    const data = await apiClient.post('/auth/login', {
      email: username,
      password,
      device_id: DEVICE_ID,
      ...(deviceProof ? { device_proof: deviceProof } : {}),
    });
    onLogin(data);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;

    setIsLoading(true);
    setError(null);

    try {
      await login();
    } catch (err: any) {
      console.error(err);
      setError({
        message: err.message || 'فشل تسجيل الدخول',
        code: err.code,
        pairingCode: err.pairing_code,
        expiresAt: err.expires_at,
        limitReached: Boolean(err.limit_reached),
        pendingEnrollmentId: err.pending_enrollment_id,
      });
      setIsLoading(false);
    }
  };

  const handleFinalize = async () => {
    if (!error?.pendingEnrollmentId) return;
    setIsLoading(true);
    try {
      await finalizeDeviceEnrollment(error.pendingEnrollmentId);
      setError(null);
      await login();
    } catch (err: any) {
      setError({
        message: err.message || 'تعذر إكمال تفعيل الجهاز',
        code: err.code,
        pendingEnrollmentId: error.pendingEnrollmentId,
      });
      setIsLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-[100dvh] px-4 py-12 relative font-['Cairo']">
      {/* خلفية فخمة مع إضاءة خافتة جداً */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden bg-[#121212]">
        <div className="absolute top-[-20%] right-[-10%] w-[60%] h-[60%] bg-[#E53935] opacity-[0.04] blur-[160px] rounded-full"></div>
        <div className="absolute bottom-[-20%] left-[-10%] w-[60%] h-[60%] bg-[#E6D690] opacity-[0.04] blur-[160px] rounded-full"></div>
      </div>

      <div className="w-full max-w-md z-10">
        {/* قسم الشعار (مطابق للصورة تماماً) */}
        <div className="flex flex-col items-center mb-12">
          <div className="relative w-48 h-48 flex items-center justify-center group">
            {/* إضاءة محيطية خلف الشعار */}
            <div className="absolute inset-4 bg-[#E6D690] opacity-[0.07] blur-[40px] rounded-full transition-opacity group-hover:opacity-15 duration-1000"></div>

            <div className="w-full h-full relative z-10">
              <Logo />
            </div>
          </div>

          <h1 className="text-2xl font-bold tracking-[0.1em] text-[#F5F5F5] text-center mt-2 opacity-90 neon-gold-text">
            نظام الإدارة الموحد
          </h1>
        </div>

        {/* كرت تسجيل الدخول */}
        <div className="bg-[#1E1E1E]/80 backdrop-blur-xl rounded-[2.5rem] p-10 shadow-[0_20px_50px_rgba(0,0,0,0.5)] border border-white/5">
          <h2 className="text-xl font-medium text-[#F5F5F5] mb-10 text-center opacity-80">
            تسجيل الدخول
          </h2>

          <form onSubmit={handleSubmit} className="space-y-6">
            {externalError && !error && (
              <div className="border rounded-2xl p-5 text-sm text-center bg-red-500/5 border-red-500/10 text-red-300">
                {externalError}
              </div>
            )}

            <div className="space-y-2 group">
              <label className="block text-[11px] font-bold text-[#BDBDBD] uppercase tracking-widest mr-1 opacity-60">
                البريد الإلكتروني
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="البريد الإلكتروني"
                  className="w-full bg-[#121212]/50 border border-white/5 rounded-2xl py-5 pr-14 pl-5 text-[#F5F5F5] placeholder-[#BDBDBD]/20 transition-all focus-gold outline-none"
                  required
                />
                <User
                  className="absolute right-5 top-1/2 -translate-y-1/2 text-[#BDBDBD]/30 group-focus-within:text-[#E6D690] transition-colors"
                  size={20}
                />
              </div>
            </div>

            <div className="space-y-2 group">
              <label className="block text-[11px] font-bold text-[#BDBDBD] uppercase tracking-widest mr-1 opacity-60">
                كلمة المرور
              </label>
              <div className="relative">
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-[#121212]/50 border border-white/5 rounded-2xl py-5 pr-14 pl-5 text-[#F5F5F5] placeholder-[#BDBDBD]/20 transition-all focus-gold outline-none"
                  required
                />
                <Lock
                  className="absolute right-5 top-1/2 -translate-y-1/2 text-[#BDBDBD]/30 group-focus-within:text-[#E6D690] transition-colors"
                  size={20}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className={`w-full bg-[#E53935] hover:bg-[#ff4040] text-white font-bold py-5 rounded-2xl transition-all duration-500 transform active:scale-95 neon-red-shadow flex items-center justify-center gap-3 text-lg mt-4 ${isLoading ? 'opacity-70 cursor-not-allowed' : ''}`}
            >
              {isLoading ? (
                <div className="w-6 h-6 border-[3px] border-white/20 border-t-white rounded-full animate-spin"></div>
              ) : (
                'تسجيل الدخول'
              )}
            </button>

            {error && (
              <div className={`mt-6 border rounded-2xl p-5 text-sm text-center animate-in fade-in slide-in-from-top-2 duration-300 ${
                isUnauthorizedDeviceError || isEnrollmentRequired || isFinalizationRequired || isProofRepairRequired
                ? 'bg-[#E53935]/10 border-[#E53935]/30 text-[#E53935]'
                : 'bg-red-500/5 border-red-500/10 text-red-400'
              }`}>
                {isEnrollmentRequired
                  ? (
                    <div className="space-y-3">
                      <p className="font-bold text-lg mb-1">هذا الجهاز غير مسجل لهذا الفرع</p>
                      <p className="opacity-80 leading-relaxed font-medium">اطلب من الإدارة اعتماد الجهاز ثم أعد محاولة تسجيل الدخول.</p>
                      {error.pairingCode && (
                        <div className="bg-white/5 p-4 rounded-xl border border-white/5">
                          <p className="text-[11px] opacity-70 mb-2">رمز تسجيل الجهاز</p>
                          <div className="font-mono text-xl tracking-[0.3em] text-[#F5F5F5]">
                            {error.pairingCode}
                          </div>
                        </div>
                      )}
                      <p className="text-xs opacity-70">الرمز صالح لفترة محدودة.</p>
                      {error.limitReached && (
                        <p className="text-xs font-bold leading-relaxed">
                          الفرع وصل حالياً إلى الحد الأقصى للأجهزة النشطة. قد تحتاج الإدارة إلى إلغاء جهاز حالي قبل الاعتماد.
                        </p>
                      )}
                    </div>
                  )
                  : isFinalizationRequired
                  ? (
                    <div className="space-y-3">
                      <p className="font-bold text-lg mb-1">تم اعتماد هذا الجهاز</p>
                      <p className="opacity-80 leading-relaxed font-medium">
                        أكمل التفعيل من هذا المتصفح لاستلام اعتماد الجهاز الآمن.
                      </p>
                      <button
                        type="button"
                        onClick={handleFinalize}
                        disabled={isLoading || !error.pendingEnrollmentId}
                        className="w-full bg-[#E6D690] text-[#121212] font-bold py-3 rounded-xl disabled:opacity-50"
                      >
                        إكمال تفعيل الجهاز
                      </button>
                    </div>
                  )
                  : isProofRepairRequired
                  ? (
                    <div className="space-y-2">
                      <p className="font-bold text-lg mb-1">إعادة ربط الجهاز مطلوبة</p>
                      <p className="opacity-80 leading-relaxed font-medium">
                        مفتاح الجهاز الآمن غير موجود أو لا يطابق التسجيل. اطلب من الإدارة بدء إعادة الربط، ثم أكمل التفعيل من الوضع العادي للمتصفح.
                      </p>
                    </div>
                  )
                  : isUnauthorizedDeviceError
                  ? (
                    <div className="space-y-2">
                       <p className="font-bold text-lg mb-1">عذراً، هذا الجهاز غير مفعل</p>
                       <p className="opacity-80 leading-relaxed font-medium">هذا الجهاز لا يملك صلاحية دخول لفرعك. الرجاء التواصل مع مسؤول النظام لتفعيل هذا الجهاز عبر:</p>
                       <div className="bg-white/5 p-3 rounded-lg mt-2 font-mono text-[10px] break-all border border-white/5 select-all">
                        {DEVICE_ID}
                       </div>
                    </div>
                  ) 
                  : error.message
                }
              </div>
            )}
          </form>

          <p className="mt-10 text-center text-[10px] text-[#BDBDBD]/40 tracking-wider">
            الدخول مخصص لموظفي الفرع فقط
          </p>
        </div>

        {/* خطوط تجميلية سفلية */}
        <div className="mt-16 flex justify-center items-center gap-4 opacity-10">
          <div className="h-[1px] w-12 bg-white"></div>
          <div className="w-1.5 h-1.5 rounded-full bg-[#E6D690]"></div>
          <div className="h-[1px] w-12 bg-white"></div>
        </div>
      </div>
    </div>
  );
};

export default LoginScreen;
