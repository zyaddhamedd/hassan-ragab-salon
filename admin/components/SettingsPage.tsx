import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
    Settings,
    UserPlus,
    Users,
    Shield,
    MoreVertical,
    UserCheck,
    UserX,
    Edit2,
    Eye,
    EyeOff,
    Plus,
    X,
    Lock,
    User,
    Building2,
    ShieldCheck,
    AlertCircle,
    Loader2,
    Trash2,
    Smartphone
} from 'lucide-react';
import adminApi from '../api/client';
import { Branch } from '../types';
import BranchManagement from './BranchManagement';

interface UserAccount {
    id: number;
    username: string; // This corresponds to email in backend
    full_name: string;
    role: string;
    branch_id: number | null;
    branch: string | null;
    is_active: boolean;
    created_at: string;
}

interface SettingsPageProps {
    isDarkMode: boolean;
}

const SettingsPage: React.FC<SettingsPageProps> = ({ isDarkMode }) => {
    // State
    const [accounts, setAccounts] = useState<UserAccount[]>([]);
    const [branches, setBranches] = useState<Branch[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Modals
    const [showCashierModal, setShowCashierModal] = useState(false);
    const [showAdminModal, setShowAdminModal] = useState(false);
    const [showStoreManagerModal, setShowStoreManagerModal] = useState(false);
    const [showSuccessModal, setShowSuccessModal] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [showEditModal, setShowEditModal] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    // UI State
    const [activeMenu, setActiveMenu] = useState<number | null>(null);
    const [latestAccount, setLatestAccount] = useState<UserAccount | null>(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [editingUser, setEditingUser] = useState<UserAccount | null>(null);
    const [deletingUser, setDeletingUser] = useState<UserAccount | null>(null);
    const [activeSection, setActiveSection] = useState<'accounts' | 'branches'>('accounts');

    // Ref for outside-click
    const menuRef = useRef<HTMLDivElement | null>(null);

    // Form State
    const [formData, setFormData] = useState({
        full_name: '',
        username: '',
        password: '',
        confirmPassword: '',
        branch_id: '',
        role: 'SUPER_ADMIN', // Default for Admin modal
        is_active: true
    });

    // Force scroll to top on mount
    useEffect(() => {
        window.scrollTo(0, 0);
    }, []);

    // Fetch Initial Data
    useEffect(() => {
        fetchUsers();
        fetchBranches();
    }, []);

    // Close dropdown on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setActiveMenu(null);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    // Get current logged-in admin id from localStorage
    const getCurrentAdminId = (): number | null => {
        try {
            const raw = localStorage.getItem('admin_user');
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            return parsed?.id ?? null;
        } catch { return null; }
    };

    const fetchUsers = async () => {
        setIsLoading(true);
        try {
            const res = await adminApi.get('/users');
            setAccounts(res.data);
        } catch (error) {
            console.error("Failed to fetch users", error);
        } finally {
            setIsLoading(false);
        }
    };

    const fetchBranches = async () => {
        try {
            const res = await adminApi.get('/branches?exclude_main_warehouse=true');
            setBranches(res.data);
        } catch (error) {
            console.error("Failed to fetch branches", error);
        }
    };

    const resetForm = () => {
        setFormData({
            full_name: '',
            username: '',
            password: '',
            confirmPassword: '',
            branch_id: '',
            role: 'SUPER_ADMIN',
            is_active: true
        });
        setErrorMsg(null);
        setShowPassword(false);
    };

    const openCashierModal = () => {
        resetForm();
        setFormData(prev => ({ ...prev, role: 'CASHIER' }));
        setShowCashierModal(true);
    };

    const openAdminModal = () => {
        resetForm();
        setFormData(prev => ({ ...prev, role: 'SUPER_ADMIN' }));
        setShowAdminModal(true);
    };

    const openStoreManagerModal = () => {
        resetForm();
        setFormData(prev => ({ ...prev, role: 'STORE_MANAGER', branch_id: '' }));
        setShowStoreManagerModal(true);
    };

    const closeAccountModals = () => {
        setShowCashierModal(false);
        setShowAdminModal(false);
        setShowStoreManagerModal(false);
        setShowEditModal(false);
        setEditingUser(null);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setErrorMsg(null);

        // ── EDIT MODE ──────────────────────────────────────────
        if (showEditModal && editingUser) {
            if (!formData.full_name.trim()) {
                setErrorMsg('يرجى إدخال الاسم الظاهر');
                return;
            }

            if (!formData.username.trim()) {
                setErrorMsg('يرجى إدخال اسم المستخدم');
                return;
            }

            // Password validation only if provided
            if (formData.password) {
                if (formData.password !== formData.confirmPassword) {
                    setErrorMsg('كلمة المرور غير متطابقة');
                    return;
                }
                if (formData.password.length < 4) {
                    setErrorMsg('كلمة المرور يجب أن تكون 4 أحرف على الأقل');
                    return;
                }
            }

            setIsSubmitting(true);
            try {
                const payload: Record<string, any> = {
                    full_name: formData.full_name.trim(),
                    email: formData.username.trim(),
                };
                if (formData.password) {
                    payload.password = formData.password;
                }
                if (editingUser.role === 'CASHIER' && formData.branch_id) {
                    payload.branch_id = Number(formData.branch_id);
                }

                await adminApi.put(`/users/${editingUser.id}`, payload);
                setShowEditModal(false);
                setEditingUser(null);
                resetForm();
                fetchUsers();
            } catch (error: any) {
                setErrorMsg(error.response?.data?.error || 'حدث خطأ أثناء التعديل');
            } finally {
                setIsSubmitting(false);
            }
            return;
        }

        // ── CREATE MODE ────────────────────────────────────────
        if (!formData.full_name.trim()) {
            setErrorMsg('يرجى إدخال الاسم الظاهر');
            return;
        }

        if (!formData.username.trim()) {
            setErrorMsg('يرجى إدخال اسم المستخدم');
            return;
        }

        // Validation
        if (formData.password !== formData.confirmPassword) {
            setErrorMsg('كلمة المرور غير متطابقة');
            return;
        }

        if (formData.password.length < 4) {
            setErrorMsg('كلمة المرور يجب أن تكون 4 أحرف على الأقل');
            return;
        }

        if (formData.role === 'CASHIER' && !formData.branch_id) {
            setErrorMsg('يرجى اختيار الفرع');
            return;
        }

        setIsSubmitting(true);

        try {
            const payload = {
                full_name: formData.full_name.trim(),
                username: formData.username.trim(),
                password: formData.password,
                role: formData.role,
                branch_id: formData.role === 'CASHIER' && formData.branch_id ? Number(formData.branch_id) : null,
                is_active: formData.is_active
            };

            const res = await adminApi.post('/users', payload);

            // Success
            setLatestAccount({
                ...res.data.user,
                branch: formData.role === 'CASHIER'
                    ? branches.find(b => b.id === Number(formData.branch_id))?.name || null
                    : null
            });
            setShowSuccessModal(true);
            closeAccountModals();
            fetchUsers(); // Refresh list

        } catch (error: any) {
            console.error('Creation failed', error);
            setErrorMsg(error.response?.data?.error || 'حدث خطأ أثناء الإنشاء');
        } finally {
            setIsSubmitting(false);
        }
    };

    const openEditModal = (account: UserAccount) => {
        setActiveMenu(null);
        setEditingUser(account);
        setFormData({
            full_name: account.full_name || '',
            username: account.username,
            password: '',
            confirmPassword: '',
            branch_id: account.branch_id ? String(account.branch_id) : '',
            role: account.role,
            is_active: account.is_active,
        });
        setErrorMsg(null);
        setShowPassword(false);
        setShowEditModal(true);
    };

    const handleDeleteConfirm = async () => {
        if (!deletingUser) return;
        setIsSubmitting(true);
        try {
            await adminApi.delete(`/users/${deletingUser.id}`);
            setShowDeleteConfirm(false);
            setDeletingUser(null);
            setActiveMenu(null);
            fetchUsers();
        } catch (error: any) {
            console.error('Delete failed', error);
        } finally {
            setIsSubmitting(false);
        }
    };

    // Helper to format role name
    const formatRole = (role: string) => {
        switch (role) {
            case 'SUPER_ADMIN': return 'مدير كامل';
            case 'CASHIER': return 'كاشير فرع';
            case 'EXEC_ADMIN': return 'مدير تنفيذي';
            default: return role;
        }
    };

    const getRoleLabel = (role: string) => {
        switch (role) {
            case 'SUPER_ADMIN':
                return 'إدارة عليا';
            case 'STORE_MANAGER':
                return 'مدير المخزن';
            case 'CASHIER':
                return 'كاشير';
            case 'EXEC_ADMIN':
                return 'مدير تنفيذي';
            default:
                return role;
        }
    };

    const formatAccessScope = (account: UserAccount) => {
        if (account.role === 'STORE_MANAGER') return 'كل الفروع / مركز الإمداد';
        if (account.role === 'SUPER_ADMIN') return 'صلاحية كاملة';
        if (account.role === 'EXEC_ADMIN') return 'إدارة تنفيذية عامة';
        return account.branch || '-';
    };

    const getRoleAccent = (role: string) => {
        if (role === 'STORE_MANAGER') {
            return isDarkMode ? 'bg-emerald-500/15 text-emerald-400' : 'bg-emerald-50 text-emerald-700';
        }
        if (role === 'CASHIER') {
            return isDarkMode ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-50 text-blue-600';
        }
        return isDarkMode ? 'bg-[#E6D690]/20 text-[#E6D690]' : 'bg-[#E6D690]/10 text-black';
    };

    const isEditingCashier = showEditModal && editingUser?.role === 'CASHIER';
    const isEditingStoreManager = showEditModal && editingUser?.role === 'STORE_MANAGER';
    const isCashierFlow = showCashierModal || isEditingCashier;
    const isStoreManagerFlow = showStoreManagerModal || isEditingStoreManager;

    return (
        <div className="admin-page-shell space-y-8 animate-fadeIn" dir="rtl">
            {/* Scrollbar Customization */}
            <style dangerouslySetInnerHTML={{
                __html: `
        .custom-scrollbar::-webkit-scrollbar {
          width: 5px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: ${isDarkMode ? '#333' : '#ddd'};
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #E53935;
        }
      `}} />

            {/* Section Tabs */}
            <div className="flex items-center gap-6 mb-8 border-b pb-4 overflow-x-auto whitespace-nowrap scrollbar-hide select-none transition-all duration-300" 
                 style={{ borderColor: isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }}>
                <button 
                    onClick={() => setActiveSection('accounts')}
                    className={`flex items-center gap-3 px-6 py-3 rounded-xl font-bold text-sm transition-all duration-500 relative group ${
                        activeSection === 'accounts' 
                            ? (isDarkMode ? 'bg-white/5 text-white' : 'bg-black/5 text-[#121212]') 
                            : (isDarkMode ? 'text-white/30 hover:text-white/60' : 'text-gray-400 hover:text-gray-600')
                    }`}
                >
                    <Users size={18} className={activeSection === 'accounts' ? 'text-[#E53935]' : ''} />
                    <span>إدارة الحسابات</span>
                    {activeSection === 'accounts' && (
                        <div className="absolute -bottom-[17px] left-0 right-0 h-0.5 bg-[#E53935] z-10 animate-scaleX" />
                    )}
                </button>
                <button 
                    onClick={() => setActiveSection('branches')}
                    className={`flex items-center gap-3 px-6 py-3 rounded-xl font-bold text-sm transition-all duration-500 relative group ${
                        activeSection === 'branches' 
                            ? (isDarkMode ? 'bg-white/5 text-white' : 'bg-black/5 text-[#121212]') 
                            : (isDarkMode ? 'text-white/30 hover:text-white/60' : 'text-gray-400 hover:text-gray-600')
                    }`}
                >
                    <Smartphone size={18} className={activeSection === 'branches' ? 'text-[#E53935]' : ''} />
                    <span>تأمين الأجهزة</span>
                    {activeSection === 'branches' && (
                        <div className="absolute -bottom-[17px] left-0 right-0 h-0.5 bg-[#E53935] z-10 animate-scaleX" />
                    )}
                </button>
            </div>

            {activeSection === 'accounts' ? (
                <>
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 text-right">
                        {/* Cashier Management Card */}
                        <div className={`p-8 border rounded-2xl theme-transition ${isDarkMode ? 'bg-[#161616] border-white/5 shadow-2xl shadow-black/40' : 'bg-white border-black/5 shadow-lg'
                            }`}>
                            <div className="flex items-center justify-between mb-8">
                                <div className="flex items-center gap-4">
                                    <div className={`p-3 rounded-xl ${isDarkMode ? 'bg-blue-500/10 text-blue-400' : 'bg-blue-50/50 text-blue-600'}`}>
                                        <Building2 size={24} />
                                    </div>
                                    <div className="text-right">
                                        <h2 className={`text-xl font-bold ${isDarkMode ? 'text-white' : 'text-[#121212]'}`}>حسابات الكاشير</h2>
                                        <p className={`text-xs mt-1 ${isDarkMode ? 'text-[#7A7A7A]' : 'text-gray-400'}`}>إدارة وصول موظفي الفروع للنظام</p>
                                    </div>
                                </div>
                            </div>

                            <div className="flex flex-col gap-6">
                                <button
                                    onClick={openCashierModal}
                                    className="w-full h-14 bg-[#E53935] hover:bg-[#FF3B30] text-white rounded-xl font-bold text-sm tracking-widest transition-all flex items-center justify-center gap-3 shadow-xl shadow-red-900/10 active:scale-[0.98]"
                                >
                                    <Plus size={20} />
                                    <span>إنشاء حساب كاشير جديد</span>
                                </button>
                                <p className={`text-center text-[11px] leading-relaxed px-4 ${isDarkMode ? 'text-[#555]' : 'text-gray-400'}`}>
                                    عند إنشاء حساب جديد، سيتمكن الموظف من تسجيل الدخول من خلال نظام الفرع فقط وتنفيذ العمليات المصرح بها.
                                </p>
                            </div>
                        </div>

                        {/* Admin Management Card */}
                        <div className={`p-8 border rounded-2xl theme-transition ${isDarkMode ? 'bg-[#161616] border-white/5 shadow-2xl shadow-black/40' : 'bg-white border-black/5 shadow-lg'
                            }`}>
                            <div className="flex items-center justify-between mb-8">
                                <div className="flex items-center gap-4">
                                    <div className={`p-3 rounded-xl ${isDarkMode ? 'bg-[#E6D690]/10 text-[#E6D690]' : 'bg-[#E6D690]/5 text-[#C5A059]'}`}>
                                        <Shield size={24} />
                                    </div>
                                    <div className="text-right">
                                        <h2 className={`text-xl font-bold ${isDarkMode ? 'text-white' : 'text-[#121212]'}`}>حسابات الإدارة</h2>
                                        <p className={`text-xs mt-1 ${isDarkMode ? 'text-[#7A7A7A]' : 'text-gray-400'}`}>إدارة صلاحيات الإدارة العليا والمشرفين</p>
                                    </div>
                                </div>
                            </div>

                            <div className="flex flex-col gap-6">
                                <button
                                    onClick={openAdminModal}
                                    className={`w-full h-14 border rounded-xl font-bold text-sm tracking-widest transition-all flex items-center justify-center gap-3 active:scale-[0.98] ${isDarkMode ? 'border-white/10 text-white hover:bg-white/5' : 'border-black/5 text-[#121212] hover:bg-black/5'
                                        }`}
                                >
                                    <UserPlus size={20} />
                                    <span>إضافة مستخدم إداري</span>
                                </button>
                                <div className={`flex items-start gap-3 p-4 rounded-xl border ${isDarkMode ? 'bg-red-500/5 border-red-500/10 text-red-400' : 'bg-red-50 border-red-100 text-red-600'
                                    }`}>
                                    <AlertCircle size={18} className="shrink-0 mt-0.5" />
                                    <p className="text-[11px] leading-relaxed text-right">
                                        <span className="font-bold underline">تحذير أمني:</span> هذه الحسابات لها صلاحيات كاملة على النظام. يرجى توخي الحذر عند منح هذه الصلاحيات لأي مستخدم جديد.
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className={`p-8 border rounded-2xl theme-transition ${isDarkMode ? 'bg-[#161616] border-white/5 shadow-2xl shadow-black/40' : 'bg-white border-black/5 shadow-lg'
                            }`}>
                            <div className="flex items-center justify-between mb-8">
                                <div className="flex items-center gap-4">
                                    <div className={`p-3 rounded-xl ${isDarkMode ? 'bg-emerald-500/10 text-emerald-400' : 'bg-emerald-50 text-emerald-700'}`}>
                                        <Settings size={24} />
                                    </div>
                                    <div className="text-right">
                                        <h2 className={`text-xl font-bold ${isDarkMode ? 'text-white' : 'text-[#121212]'}`}>حسابات مدير المخزن</h2>
                                        <p className={`text-xs mt-1 ${isDarkMode ? 'text-[#7A7A7A]' : 'text-gray-400'}`}>وصول مخصص لمركز الإمداد على مستوى جميع الفروع</p>
                                    </div>
                                </div>
                            </div>

                            <div className="flex flex-col gap-6">
                                <button
                                    onClick={openStoreManagerModal}
                                    className={`w-full h-14 rounded-xl font-bold text-sm tracking-widest transition-all flex items-center justify-center gap-3 active:scale-[0.98] ${isDarkMode ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 hover:bg-emerald-500/15' : 'bg-emerald-50 text-emerald-700 border border-emerald-100 hover:bg-emerald-100'}`}
                                >
                                    <UserPlus size={20} />
                                    <span>إضافة مدير مخزن</span>
                                </button>
                                <div className={`flex items-start gap-3 p-4 rounded-xl border ${isDarkMode ? 'bg-emerald-500/5 border-emerald-500/10 text-emerald-300' : 'bg-emerald-50 border-emerald-100 text-emerald-700'}`}>
                                    <ShieldCheck size={18} className="shrink-0 mt-0.5" />
                                    <p className="text-[11px] leading-relaxed text-right">
                                        هذا الحساب يدخل الأدمن فقط، ويعمل داخل مركز الإمداد بدون ربط بفرع واحد.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Existing Accounts Table */}
                    <div className={`mt-10 border rounded-2xl overflow-hidden theme-transition ${isDarkMode ? 'bg-[#161616] border-white/5' : 'bg-white border-black/5 shadow-xl shadow-black/5'
                        }`}>
                        <div className={`px-8 py-5 border-b flex items-center justify-between ${isDarkMode ? 'border-white/5' : 'border-black/5'}`}>
                            <div className="flex items-center gap-3">
                                <Users size={18} className={isDarkMode ? 'text-[#E6D690]' : 'text-[#C5A059]'} />
                                <h3 className={`font-bold ${isDarkMode ? 'text-white' : 'text-[#121212]'}`}>الحسابات النشطة</h3>
                            </div>
                            <span className={`text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-tighter ${isDarkMode ? 'bg-white/5 text-[#7A7A7A]' : 'bg-gray-100 text-gray-500'
                                }`}>
                                {accounts.length} حساب إجمالي
                            </span>
                        </div>

                        <div className="overflow-x-auto">
                            {isLoading ? (
                                <div className="flex justify-center items-center py-10">
                                    <Loader2 className={`animate-spin ${isDarkMode ? 'text-white' : 'text-black'}`} size={24} />
                                </div>
                            ) : (
                                <table className="w-full text-right">
                                    <thead>
                                        <tr className={`text-[11px] font-bold uppercase tracking-widest ${isDarkMode ? 'bg-white/[0.02] text-[#555]' : 'bg-gray-50 text-gray-400'}`}>
                                            <th className="px-8 py-4">اسم المستخدم</th>
                                            <th className="px-8 py-4">نوع الحساب</th>
                                            <th className="px-8 py-4">الفرع / المستوى</th>
                                            <th className="px-8 py-4 text-center">الحالة</th>
                                            <th className="px-8 py-4 text-left">الإجراءات</th>
                                        </tr>
                                    </thead>
                                    <tbody className={`divide-y ${isDarkMode ? 'divide-white/5' : 'divide-black/5'}`}>
                                        {accounts.map((account) => (
                                            <tr key={account.id} className={`group theme-transition ${isDarkMode ? 'hover:bg-white/[0.02]' : 'hover:bg-gray-50'}`}>
                                                <td className="px-8 py-4">
                                                    <div className="flex items-center gap-3">
                                                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs ${getRoleAccent(account.role)}`}>
                                                            {account.username.charAt(0).toUpperCase()}
                                                        </div>
                                                        <div className="flex flex-col gap-0.5">
                                                            <span className={`text-sm font-bold ${isDarkMode ? 'text-white' : 'text-[#121212]'}`}>
                                                                {account.full_name || account.username}
                                                            </span>
                                                            <span className={`text-[11px] ${isDarkMode ? 'text-[#7A7A7A]' : 'text-gray-400'}`} dir="ltr">
                                                                {account.username}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-8 py-4">
                                                    <span className={`text-[11px] font-bold ${isDarkMode ? 'text-[#9E9E9E]' : 'text-gray-500'}`}>
                                                        {getRoleLabel(account.role)}
                                                    </span>
                                                </td>
                                                <td className="px-8 py-4">
                                                    <span className={`text-[11px] ${isDarkMode ? 'text-[#7A7A7A]' : 'text-gray-400'}`}>
                                                        {account.branch || (account.role === 'SUPER_ADMIN' ? 'صلاحية كاملة' : '-')}
                                                    </span>
                                                </td>
                                                <td className="px-8 py-4">
                                                    <div className="flex justify-center">
                                                        <span className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold ${account.is_active
                                                            ? (isDarkMode ? 'bg-emerald-500/10 text-emerald-400' : 'bg-emerald-50 text-emerald-600')
                                                            : (isDarkMode ? 'bg-red-500/10 text-red-400' : 'bg-red-50 text-red-600')
                                                            }`}>
                                                            <div className={`w-1 h-1 rounded-full ${account.is_active ? 'bg-current' : 'bg-current pulse'}`}></div>
                                                            {account.is_active ? 'نشط' : 'معطل'}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td className="px-8 py-4 text-left relative">
                                                    <div ref={activeMenu === account.id ? menuRef : null} className="relative inline-block">
                                                        <button
                                                            onClick={() => setActiveMenu(activeMenu === account.id ? null : account.id)}
                                                            className={`p-2 rounded-lg transition-colors ${isDarkMode ? 'text-[#7A7A7A] hover:bg-white/10 hover:text-white' : 'text-gray-400 hover:bg-black/5 hover:text-[#121212]'}`}
                                                        >
                                                            <MoreVertical size={18} />
                                                        </button>

                                                        {activeMenu === account.id && (
                                                            <div
                                                                className={`absolute left-0 top-full mt-1 w-44 rounded-xl border shadow-2xl z-50 overflow-hidden animate-fadeIn ${isDarkMode ? 'bg-[#1E1E1E] border-white/10 shadow-black/60' : 'bg-white border-black/10 shadow-gray-200'
                                                                    }`}
                                                            >
                                                                <button
                                                                    onClick={() => openEditModal(account)}
                                                                    className={`flex items-center gap-3 w-full px-4 py-3 text-sm font-bold transition-colors text-right ${isDarkMode ? 'text-white hover:bg-white/5' : 'text-[#121212] hover:bg-gray-50'
                                                                        }`}
                                                                >
                                                                    <Edit2 size={15} className="shrink-0" />
                                                                    تعديل الحساب
                                                                </button>
                                                                <div className={`h-px mx-3 ${isDarkMode ? 'bg-white/5' : 'bg-black/5'}`} />
                                                                <button
                                                                    onClick={() => {
                                                                        if (getCurrentAdminId() === account.id) return;
                                                                        setDeletingUser(account);
                                                                        setActiveMenu(null);
                                                                        setShowDeleteConfirm(true);
                                                                    }}
                                                                    disabled={getCurrentAdminId() === account.id}
                                                                    className={`flex items-center gap-3 w-full px-4 py-3 text-sm font-bold transition-colors text-right ${getCurrentAdminId() === account.id
                                                                        ? 'opacity-40 cursor-not-allowed text-red-400'
                                                                        : 'text-red-500 hover:bg-red-500/10'
                                                                        }`}
                                                                >
                                                                    <Trash2 size={15} className="shrink-0" />
                                                                    حذف الحساب
                                                                </button>
                                                            </div>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </div>

                    {/* Account Creation Modal */}
                    {(showCashierModal || showAdminModal || showStoreManagerModal || showEditModal) && createPortal(
                        <div className="admin-overlay-shell z-[9999] overflow-hidden">
                            <div className="absolute inset-0 bg-black/80 backdrop-blur-md animate-fadeIn" onClick={closeAccountModals}></div>
                            <div className={`admin-overlay-panel relative w-full max-w-lg rounded-[2.5rem] border shadow-2xl animate-slideUp ${isDarkMode ? 'bg-[#121212] border-white/10' : 'bg-white border-black/10'}`}>
                                <div className={`px-10 py-7 border-b flex items-center justify-between shrink-0 ${isDarkMode ? 'bg-white/[0.03] border-white/5' : 'bg-gray-50 border-black/5'}`}>
                                    <div className="flex items-center gap-4 text-right">
                                        <div className={`p-4 rounded-2xl ${showEditModal ? 'bg-[#E53935]/10 text-[#E53935]' : isCashierFlow ? 'bg-blue-500/10 text-blue-400' : isStoreManagerFlow ? 'bg-emerald-500/10 text-emerald-400' : 'bg-[#E6D690]/10 text-[#E6D690]'}`}>
                                            {showEditModal ? <Edit2 size={24} /> : isCashierFlow ? <Building2 size={24} /> : isStoreManagerFlow ? <Settings size={24} /> : <ShieldCheck size={24} />}
                                        </div>
                                        <div>
                                            <h3 className={`text-xl font-bold ${isDarkMode ? 'text-white' : 'text-[#121212]'}`}>{showEditModal ? 'تعديل الحساب' : isCashierFlow ? 'حساب كاشير جديد' : isStoreManagerFlow ? 'حساب مدير مخزن جديد' : 'مستخدم إداري جديد'}</h3>
                                            <p className="text-[10px] uppercase font-bold tracking-widest mt-0.5 text-[#7A7A7A]">{showEditModal ? `تعديل: ${editingUser?.username}` : isCashierFlow ? 'ربط موظف بفرع محدد' : isStoreManagerFlow ? 'صلاحية مركز الإمداد على كل الفروع' : 'صلاحيات وصول كاملة'}</p>
                                        </div>
                                    </div>
                                    <button onClick={closeAccountModals} className="p-2.5 rounded-full hover:bg-white/10 text-[#7A7A7A] hover:text-white transition-colors"><X size={24} /></button>
                                </div>
                                <div className="flex-1 overflow-y-auto custom-scrollbar p-10 space-y-8">
                                    <form id="account-form" className="space-y-8" onSubmit={handleSubmit}>
                                        {errorMsg && <div className="bg-red-500/10 border border-red-500/20 text-red-500 p-4 rounded-xl text-center text-sm font-bold animate-shake">{errorMsg}</div>}
                                        {isCashierFlow && (
                                            <div className="space-y-3 text-right">
                                                <label className="text-[11px] font-bold uppercase tracking-widest mr-1 text-[#7A7A7A]">الفرع المسؤول</label>
                                                <div className="relative">
                                                    <Building2 size={20} className="absolute right-5 top-1/2 -translate-y-1/2 text-[#555]" />
                                                    <select required={isCashierFlow} value={formData.branch_id} onChange={(e) => setFormData({ ...formData, branch_id: e.target.value })} className={`w-full h-16 pr-14 pl-5 border rounded-2xl outline-none text-sm transition-all font-bold appearance-none ${isDarkMode ? 'bg-[#0B0B0B] border-white/5 text-white focus:border-[#E53935]/40' : 'bg-gray-50 border-gray-200 text-[#121212] focus:border-[#E53935]/40'}`}><option value="" disabled>اختر الفرع...</option>{branches.map(b => (<option key={b.id} value={b.id}>{b.name}</option>))}</select>
                                                </div>
                                            </div>
                                        )}
                                        <div className="space-y-3 text-right">
                                            <label className="text-[11px] font-bold uppercase tracking-widest mr-1 text-[#7A7A7A]">اسم المستخدم</label>
                                            <div className="relative">
                                                <User size={20} className="absolute right-5 top-1/2 -translate-y-1/2 text-[#555]" />
                                                <input type="text" required dir="ltr" placeholder="USERNAME" value={formData.username} onChange={(e) => setFormData({ ...formData, username: e.target.value })} className={`w-full h-16 pr-14 pl-5 border rounded-2xl outline-none text-sm transition-all font-bold tracking-widest text-right ${isDarkMode ? 'bg-[#0B0B0B] border-white/5 text-white focus:border-[#E53935]/40 placeholder:text-white/10' : 'bg-gray-50 border-gray-200 text-[#121212] focus:border-[#E53935]/40 placeholder:text-gray-300'}`} />
                                            </div>
                                        </div>
                                        <div className="space-y-3 text-right">
                                            <label className="text-[11px] font-bold uppercase tracking-widest mr-1 text-[#7A7A7A]">الاسم الظاهر</label>
                                            <div className="relative">
                                                <ShieldCheck size={20} className="absolute right-5 top-1/2 -translate-y-1/2 text-[#555]" />
                                                <input
                                                    type="text"
                                                    required
                                                    placeholder="الاسم الظاهر"
                                                    value={formData.full_name}
                                                    onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                                                    className={`w-full h-16 pr-14 pl-5 border rounded-2xl outline-none text-sm transition-all font-bold text-right ${isDarkMode ? 'bg-[#0B0B0B] border-white/5 text-white focus:border-[#E53935]/40 placeholder:text-white/20' : 'bg-gray-50 border-gray-200 text-[#121212] focus:border-[#E53935]/40 placeholder:text-gray-300'}`}
                                                />
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                                            <div className="space-y-3 text-right">
                                                <label className="text-[11px] font-bold uppercase tracking-widest mr-1 text-[#7A7A7A]">{showEditModal ? 'كلمة مرور جديدة (اختياري)' : 'كلمة المرور'}</label>
                                                <div className="relative">
                                                    <Lock size={20} className="absolute right-5 top-1/2 -translate-y-1/2 text-[#555]" />
                                                    <input type={showPassword ? 'text' : 'password'} required={!showEditModal} placeholder={showEditModal ? 'اتركها فارغة للإبقاء' : '••••••••'} value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} className={`w-full h-16 pr-14 pl-12 border rounded-2xl outline-none text-sm transition-all font-bold tracking-widest ${isDarkMode ? 'bg-[#0B0B0B] border-white/5 text-white focus:border-[#E53935]/40 placeholder:text-white/20' : 'bg-gray-50 border-gray-200 text-[#121212] focus:border-[#E53935]/40 placeholder:text-gray-300'}`} />
                                                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute left-5 top-1/2 -translate-y-1/2 text-[#555] hover:text-[#9E9E9E]">{showPassword ? <EyeOff size={20} /> : <Eye size={20} />}</button>
                                                </div>
                                            </div>
                                            <div className="space-y-3 text-right">
                                                <label className="text-[11px] font-bold uppercase tracking-widest mr-1 text-[#7A7A7A]">تأكيد المرور</label>
                                                <div className="relative">
                                                    <Lock size={20} className="absolute right-5 top-1/2 -translate-y-1/2 text-[#555]" />
                                                    <input type={showPassword ? 'text' : 'password'} required={!showEditModal || !!formData.password} placeholder="••••••••" value={formData.confirmPassword} onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })} className={`w-full h-16 pr-14 pl-5 border rounded-2xl outline-none text-sm transition-all font-bold tracking-widest ${isDarkMode ? 'bg-[#0B0B0B] border-white/5 text-white focus:border-[#E53935]/40' : 'bg-gray-50 border-gray-200 text-[#121212] focus:border-[#E53935]/40'}`} />
                                                </div>
                                            </div>
                                        </div>
                                    </form>
                                </div>
                                <div className={`p-8 border-t flex gap-5 shrink-0 ${isDarkMode ? 'bg-black/20 border-white/5' : 'bg-gray-50/50 border-black/5'}`}>
                                    <button type="button" onClick={() => { setShowCashierModal(false); setShowAdminModal(false); setShowStoreManagerModal(false); setShowEditModal(false); setEditingUser(null); }} className={`flex-1 h-14 rounded-xl font-bold text-sm transition-all active:scale-95 ${isDarkMode ? 'bg-white/5 text-white hover:bg-white/10' : 'bg-gray-200 text-[#121212] hover:bg-gray-300'}`}>إلغاء</button>
                                    <button type="submit" form="account-form" disabled={isSubmitting} className="flex-[2] h-14 bg-[#E53935] hover:bg-[#FF3B30] disabled:bg-gray-500 disabled:cursor-not-allowed text-white rounded-xl font-bold text-sm tracking-widest shadow-2xl shadow-red-900/30 active:scale-[0.98] transition-all uppercase flex items-center justify-center gap-2">{isSubmitting ? <Loader2 className="animate-spin" size={20} /> : showEditModal ? 'حفظ التعديلات' : 'حفظ الحساب الجديد'}</button>
                                </div>
                            </div>
                        </div>,
                        document.body
                    )}

                    {/* Success Modal */}
                    {showSuccessModal && createPortal(
                        <div className="admin-overlay-shell z-[9999] animate-fadeIn">
                            <div className="absolute inset-0 bg-black/90 backdrop-blur-xl" onClick={() => setShowSuccessModal(false)}></div>
                            <div className={`relative w-full max-w-sm rounded-[2rem] p-10 border shadow-2xl text-center ${isDarkMode ? 'bg-[#1C1C1C] border-white/10' : 'bg-white border-black/10'}`}>
                                <div className={`w-20 h-20 rounded-full mx-auto mb-6 flex items-center justify-center ${isDarkMode ? 'bg-emerald-500/10 text-emerald-400' : 'bg-emerald-50 text-emerald-600'}`}><ShieldCheck size={40} /></div>
                                <h3 className={`text-xl font-bold mb-8 ${isDarkMode ? 'text-white' : 'text-[#121212]'}`}>تم إنشاء الحساب بنجاح</h3>
                                <div className={`space-y-4 mb-10 p-6 rounded-2xl border text-right ${isDarkMode ? 'bg-white/[0.03] border-white/5' : 'bg-gray-50 border-black/5'}`}>
                                    <div className="flex justify-between items-center"><span className="text-[10px] uppercase font-bold tracking-widest text-[#7A7A7A]">اسم المستخدم</span><span className={`text-sm font-bold ${isDarkMode ? 'text-white' : 'text-[#121212]'}`}>{latestAccount?.username}</span></div>
                                    <div className="flex justify-between items-center"><span className="text-[10px] uppercase font-bold tracking-widest text-[#7A7A7A]">نوع الحساب</span><span className="text-xs font-bold text-[#E6D690]">{latestAccount ? getRoleLabel(latestAccount.role) : '-'}</span></div>
                                </div>
                                <button onClick={() => setShowSuccessModal(false)} className="w-full h-14 bg-[#E53935] hover:bg-[#FF3B30] text-white rounded-xl font-bold text-sm tracking-widest transition-all">تم</button>
                            </div>
                        </div>,
                        document.body
                    )}

                    {/* Delete Confirmation Modal */}
                    {showDeleteConfirm && deletingUser && createPortal(
                        <div className="admin-overlay-shell z-[9999] animate-fadeIn">
                            <div className="absolute inset-0 bg-black/95 backdrop-blur-xl" onClick={() => { setShowDeleteConfirm(false); setDeletingUser(null); }}></div>
                            <div className={`relative w-full max-w-sm rounded-[2.5rem] border shadow-2xl p-10 text-center ${isDarkMode ? 'bg-[#121212] border-white/10' : 'bg-white border-black/10'}`}>
                                <div className="w-20 h-20 rounded-full mx-auto mb-6 bg-red-500/10 text-red-500 flex items-center justify-center"><Trash2 size={36} /></div>
                                <h3 className={`text-xl font-bold mb-3 ${isDarkMode ? 'text-white' : 'text-[#121212]'}`}>تأكيد حذف الحساب</h3>
                                <p className="text-sm text-[#7A7A7A] mb-8">سيتم تعطيل الحساب {deletingUser.username} نهائياً.</p>
                                <div className="flex flex-col gap-3">
                                    <button onClick={handleDeleteConfirm} disabled={isSubmitting} className="w-full h-14 bg-red-600 hover:bg-red-500 text-white rounded-xl font-bold text-sm tracking-widest transition-all uppercase flex items-center justify-center gap-2">{isSubmitting ? <Loader2 className="animate-spin" size={20} /> : 'تأكيد الحذف'}</button>
                                    <button onClick={() => { setShowDeleteConfirm(false); setDeletingUser(null); }} className="w-full h-12 rounded-xl font-bold text-xs text-[#7A7A7A] hover:text-white transition-all">إلغاء</button>
                                </div>
                            </div>
                        </div>,
                        document.body
                    )}
                </>
            ) : (
                <BranchManagement isDarkMode={isDarkMode} />
            )}
        </div>
    );
};

export default SettingsPage;
