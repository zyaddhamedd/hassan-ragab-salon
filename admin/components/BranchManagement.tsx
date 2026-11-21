import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    AlertTriangle,
    ChevronDown,
    Globe,
    Loader2,
    Monitor,
    RefreshCw,
    ShieldAlert,
    ShieldCheck,
    Smartphone,
    Tablet,
    Trash2,
    X,
} from 'lucide-react';
import adminApi from '../api/client';
import {
    Branch,
    PendingMiniDeviceEnrollment,
    RegisteredMiniDevice,
} from '../types';

interface BranchManagementProps {
    isDarkMode: boolean;
}

type ApprovalProfileKey = 'DESKTOP_FULL' | 'MOBILE_INVENTORY';

type EnrollmentFormState = {
    pairingCode: string;
    deviceLabel: string;
    profile: ApprovalProfileKey;
};

const DEFAULT_MOBILE_LABEL = 'موبايل المخزن';
const DEFAULT_DESKTOP_LABEL = 'كاشير الفرع';

const BranchManagement: React.FC<BranchManagementProps> = ({ isDarkMode }) => {
    const [branches, setBranches] = useState<Branch[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [submittingKey, setSubmittingKey] = useState<string | null>(null);
    const [expandedBranchId, setExpandedBranchId] = useState<number | null>(null);
    const [showResetModal, setShowResetModal] = useState<Branch | null>(null);
    const [confirmText, setConfirmText] = useState('');
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [enrollmentForms, setEnrollmentForms] = useState<Record<number, EnrollmentFormState>>({});

    useEffect(() => {
        fetchBranches();
    }, []);

    const fetchBranches = async () => {
        setIsLoading(true);
        setErrorMessage(null);
        try {
            const res = await adminApi.get('/branches?exclude_main_warehouse=true&include_device_security=true');
            setBranches(res.data);
            setExpandedBranchId((current) => (
                current && !(res.data as Branch[]).some((branch) => branch.id === current) ? null : current
            ));
            setEnrollmentForms((prev) => {
                const next = { ...prev };
                for (const branch of res.data as Branch[]) {
                    for (const enrollment of branch.device_security?.pending_enrollments || []) {
                        if (!next[enrollment.id]) {
                            next[enrollment.id] = buildInitialEnrollmentForm(enrollment);
                        }
                    }
                }
                return next;
            });
        } catch (error: any) {
            console.error('Failed to fetch branches', error);
            setErrorMessage(error.response?.data?.details || 'تعذر تحميل بيانات تأمين الأجهزة.');
        } finally {
            setIsLoading(false);
        }
    };

    const activePendingCount = useMemo(
        () => branches.reduce((sum, branch) => sum + (branch.device_security?.pending_enrollments.length || 0), 0),
        [branches],
    );

    const setEnrollmentField = (
        enrollmentId: number,
        field: keyof EnrollmentFormState,
        value: string,
    ) => {
        setEnrollmentForms((prev) => ({
            ...prev,
            [enrollmentId]: {
                ...(prev[enrollmentId] || buildInitialEnrollmentForm()),
                [field]: value,
            },
        }));
    };

    const handleApprove = async (branchId: number, enrollment: PendingMiniDeviceEnrollment) => {
        const form = enrollmentForms[enrollment.id] || buildInitialEnrollmentForm(enrollment);
        const profile = APPROVAL_PROFILES[form.profile];

        setSubmittingKey(`approve-${enrollment.id}`);
        setErrorMessage(null);
        setSuccessMessage(null);

        try {
            await adminApi.post(`/branches/${branchId}/device-enrollments/${enrollment.id}/approve`, {
                pairing_code: form.pairingCode.trim().toUpperCase(),
                device_label: form.deviceLabel.trim(),
                device_type: profile.deviceType,
                access_mode: profile.accessMode,
            });
            setSuccessMessage('تم اعتماد الجهاز بنجاح.');
            await fetchBranches();
        } catch (error: any) {
            console.error('Enrollment approval failed', error);
            setErrorMessage(error.response?.data?.details || 'تعذر اعتماد الجهاز.');
        } finally {
            setSubmittingKey(null);
        }
    };

    const handleReject = async (branchId: number, enrollmentId: number) => {
        setSubmittingKey(`reject-${enrollmentId}`);
        setErrorMessage(null);
        setSuccessMessage(null);
        try {
            await adminApi.post(`/branches/${branchId}/device-enrollments/${enrollmentId}/reject`);
            setSuccessMessage('تم رفض طلب تسجيل الجهاز.');
            await fetchBranches();
        } catch (error: any) {
            console.error('Enrollment rejection failed', error);
            setErrorMessage(error.response?.data?.details || 'تعذر رفض طلب الجهاز.');
        } finally {
            setSubmittingKey(null);
        }
    };

    const handleRevokeDevice = async (branchId: number, deviceId: number | null) => {
        if (!deviceId) return;
        setSubmittingKey(`revoke-${deviceId}`);
        setErrorMessage(null);
        setSuccessMessage(null);
        try {
            await adminApi.post(`/branches/${branchId}/registered-devices/${deviceId}/revoke`);
            setSuccessMessage('تم إلغاء الجهاز.');
            await fetchBranches();
        } catch (error: any) {
            console.error('Device revoke failed', error);
            setErrorMessage(error.response?.data?.details || 'تعذر إلغاء الجهاز.');
        } finally {
            setSubmittingKey(null);
        }
    };

    const handleRePairDevice = async (branchId: number, deviceId: number | null) => {
        if (!deviceId) return;
        setSubmittingKey(`repair-${deviceId}`);
        setErrorMessage(null);
        setSuccessMessage(null);
        try {
            await adminApi.post(`/branches/${branchId}/registered-devices/${deviceId}/re-pair`);
            setSuccessMessage('تم فتح إعادة الربط الآمن. اطلب من الجهاز إعادة تسجيل الدخول خلال 15 دقيقة.');
            await fetchBranches();
        } catch (error: any) {
            console.error('Device re-pair authorization failed', error);
            setErrorMessage(error.response?.data?.details || 'تعذر بدء إعادة ربط الجهاز.');
        } finally {
            setSubmittingKey(null);
        }
    };

    const handleReset = async () => {
        if (!showResetModal || confirmText !== 'RESET') return;

        setSubmittingKey(`reset-${showResetModal.id}`);
        setErrorMessage(null);
        setSuccessMessage(null);
        try {
            await adminApi.post(`/branches/${showResetModal.id}/reset-device`);
            setSuccessMessage('تم إلغاء جميع أجهزة الفرع النشطة.');
            setShowResetModal(null);
            setConfirmText('');
            await fetchBranches();
        } catch (error: any) {
            console.error('Branch reset failed', error);
            setErrorMessage(error.response?.data?.details || 'تعذر إلغاء أجهزة الفرع.');
        } finally {
            setSubmittingKey(null);
        }
    };

    if (isLoading) {
        return (
            <div className="flex justify-center items-center py-20">
                <Loader2 className={`animate-spin ${isDarkMode ? 'text-white' : 'text-black'}`} size={32} />
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-fadeIn" dir="rtl">
            <div className={`p-5 rounded-[2rem] border flex flex-col gap-3 md:flex-row md:items-center md:justify-between ${isDarkMode ? 'bg-[#161616] border-white/5 text-white' : 'bg-white border-black/5 text-[#121212]'}`}>
                <div className="text-right">
                    <h2 className="text-lg font-bold">تأمين الأجهزة</h2>
                    <p className={`text-sm mt-1 ${isDarkMode ? 'text-white/50' : 'text-black/50'}`}>
                        إدارة أجهزة Mini المعتمدة وطلبات التسجيل الجديدة لكل فرع.
                    </p>
                </div>
                <div className="flex items-center gap-3 text-sm font-bold">
                    <span className={`px-3 py-2 rounded-xl ${isDarkMode ? 'bg-white/5 text-white/70' : 'bg-black/5 text-black/70'}`}>
                        الطلبات الحالية: {activePendingCount}
                    </span>
                    <button
                        onClick={fetchBranches}
                        className={`h-11 px-4 rounded-xl border font-bold text-sm transition-all active:scale-[0.98] flex items-center gap-2 ${isDarkMode ? 'border-white/10 text-white hover:bg-white/5' : 'border-black/10 text-[#121212] hover:bg-black/5'}`}
                    >
                        <RefreshCw size={16} />
                        تحديث
                    </button>
                </div>
            </div>

            {successMessage && (
                <div className={`p-4 rounded-2xl border text-sm font-bold ${isDarkMode ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300' : 'bg-emerald-50 border-emerald-100 text-emerald-700'}`}>
                    {successMessage}
                </div>
            )}

            {errorMessage && (
                <div className={`p-4 rounded-2xl border text-sm font-bold ${isDarkMode ? 'bg-red-500/10 border-red-500/20 text-red-300' : 'bg-red-50 border-red-100 text-red-700'}`}>
                    {errorMessage}
                </div>
            )}

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                {branches.map((branch) => {
                    const security = branch.device_security;
                    const registeredDevices = security?.registered_devices || [];
                    const pendingEnrollments = security?.pending_enrollments || [];
                    const isExpanded = expandedBranchId === branch.id;
                    const branchStatus = getBranchStatus(
                        security?.active_device_count || 0,
                        pendingEnrollments.length,
                        security?.legacy_device_count || 0,
                        security?.pending_finalization_count || 0,
                    );

                    return (
                        <div
                            key={branch.id}
                            className={`border rounded-[2rem] theme-transition relative overflow-hidden ${
                                isDarkMode
                                    ? 'bg-[#161616] border-white/5 shadow-2xl'
                                    : 'bg-white border-black/5 shadow-lg'
                            } ${isExpanded ? 'xl:col-span-2' : ''}`}
                        >
                            <div className={`absolute top-0 right-0 left-0 h-1 ${branchStatus.accentClass}`} />

                            <button
                                type="button"
                                onClick={() => setExpandedBranchId((current) => current === branch.id ? null : branch.id)}
                                aria-expanded={isExpanded}
                                className={`w-full p-5 text-right transition-colors ${isDarkMode ? 'hover:bg-white/[0.02]' : 'hover:bg-black/[0.015]'}`}
                            >
                                <div className="flex items-start justify-between gap-4">
                                    <div className="min-w-0 flex-1 text-right">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <h3 className={`text-lg font-bold truncate ${isDarkMode ? 'text-white' : 'text-[#121212]'}`}>
                                                    {branch.name}
                                                </h3>
                                                <div className="flex items-center justify-end gap-2 mt-2 flex-wrap">
                                                    <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${isDarkMode ? 'bg-white/5 text-white/40' : 'bg-black/5 text-black/45'}`}>
                                                        #{String(branch.id).padStart(2, '0')}
                                                    </span>
                                                    <span className={`text-[11px] font-bold px-3 py-1 rounded-full ${isDarkMode ? 'bg-white/5 text-white/70' : 'bg-black/5 text-black/70'}`}>
                                                        الأجهزة النشطة: {security?.active_device_count || 0} / {security?.max_active_devices || 2}
                                                    </span>
                                                    <span className={`text-[11px] font-bold px-3 py-1 rounded-full ${pendingEnrollments.length ? 'bg-[#E53935]/10 text-[#E53935]' : (isDarkMode ? 'bg-emerald-500/10 text-emerald-300' : 'bg-emerald-50 text-emerald-700')}`}>
                                                        طلبات التسجيل: {pendingEnrollments.length}
                                                    </span>
                                                    <span className={`text-[11px] font-bold px-3 py-1 rounded-full ${isDarkMode ? 'bg-emerald-500/10 text-emerald-300' : 'bg-emerald-50 text-emerald-700'}`}>
                                                        مؤمن: {security?.secure_device_count || 0}
                                                    </span>
                                                    <span className={`text-[11px] font-bold px-3 py-1 rounded-full ${(security?.legacy_device_count || 0) > 0 ? 'bg-amber-500/10 text-amber-500' : (isDarkMode ? 'bg-white/5 text-white/40' : 'bg-black/5 text-black/40')}`}>
                                                        قديم: {security?.legacy_device_count || 0}
                                                    </span>
                                                </div>
                                            </div>
                                            <div className={`shrink-0 px-3 py-2 rounded-2xl text-xs font-bold ${branchStatus.badgeClass(isDarkMode)}`}>
                                                {branchStatus.label}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3 shrink-0">
                                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${branchStatus.iconClass(isDarkMode)}`}>
                                            {branchStatus.icon}
                                        </div>
                                        <span className={`w-10 h-10 rounded-2xl flex items-center justify-center transition-transform ${isDarkMode ? 'bg-white/5 text-white/60' : 'bg-black/5 text-black/55'} ${isExpanded ? 'rotate-180' : ''}`}>
                                            <ChevronDown size={18} />
                                        </span>
                                    </div>
                                </div>
                            </button>

                            {isExpanded && (
                                <div className="px-5 pb-5 space-y-4 animate-fadeIn">
                                    <section className="space-y-3">
                                        <div className="flex items-center justify-between">
                                            <h4 className={`text-sm font-bold ${isDarkMode ? 'text-white' : 'text-[#121212]'}`}>الأجهزة المسجلة</h4>
                                            <span className={`text-xs ${isDarkMode ? 'text-white/40' : 'text-black/40'}`}>
                                                {registeredDevices.length} جهاز
                                            </span>
                                        </div>

                                        {registeredDevices.length ? registeredDevices.map((device) => (
                                            <RegisteredDeviceCard
                                                key={`${branch.id}-${device.id}-${device.device_id}`}
                                                branchId={branch.id}
                                                device={device}
                                                isDarkMode={isDarkMode}
                                                isSubmitting={submittingKey === `revoke-${device.id}`}
                                                isRepairing={submittingKey === `repair-${device.id}`}
                                                onRevoke={handleRevokeDevice}
                                                onRePair={handleRePairDevice}
                                            />
                                        )) : (
                                            <EmptyState
                                                isDarkMode={isDarkMode}
                                                icon={<Monitor size={22} />}
                                                text="لا توجد أجهزة مسجلة لهذا الفرع حالياً."
                                            />
                                        )}
                                    </section>

                                    <section className="space-y-3">
                                        <div className="flex items-center justify-between">
                                            <h4 className={`text-sm font-bold ${isDarkMode ? 'text-white' : 'text-[#121212]'}`}>طلبات تسجيل الأجهزة</h4>
                                            <span className={`text-xs ${isDarkMode ? 'text-white/40' : 'text-black/40'}`}>
                                                {pendingEnrollments.length} طلب
                                            </span>
                                        </div>

                                        {pendingEnrollments.length ? pendingEnrollments.map((enrollment) => (
                                            <PendingEnrollmentCard
                                                key={`${branch.id}-${enrollment.id}`}
                                                branchId={branch.id}
                                                enrollment={enrollment}
                                                form={enrollmentForms[enrollment.id] || buildInitialEnrollmentForm(enrollment)}
                                                isDarkMode={isDarkMode}
                                                isApproving={submittingKey === `approve-${enrollment.id}`}
                                                isRejecting={submittingKey === `reject-${enrollment.id}`}
                                                onChange={setEnrollmentField}
                                                onApprove={handleApprove}
                                                onReject={handleReject}
                                            />
                                        )) : (
                                            <EmptyState
                                                isDarkMode={isDarkMode}
                                                icon={<Smartphone size={22} />}
                                                text="لا توجد طلبات تسجيل معلقة حالياً."
                                            />
                                        )}
                                    </section>

                                    <div className={`p-4 rounded-2xl border ${isDarkMode ? 'bg-red-500/5 border-red-500/10' : 'bg-red-50 border-red-100'}`}>
                                        <div className="flex items-start gap-3">
                                            <AlertTriangle className="text-red-500 shrink-0 mt-0.5" size={16} />
                                            <div className="text-right">
                                                <p className="text-sm font-bold text-red-500">إجراء طارئ</p>
                                                <p className={`text-xs mt-1 leading-relaxed ${isDarkMode ? 'text-white/60' : 'text-black/60'}`}>
                                                    هذا الزر يحتفظ بسلوك التوافق القديم، لكنه الآن يلغي جميع أجهزة Mini النشطة لهذا الفرع دفعة واحدة.
                                                </p>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => setShowResetModal(branch)}
                                            className="mt-4 w-full h-11 bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white rounded-xl font-bold text-sm transition-all border border-red-500/20 active:scale-[0.98] flex items-center justify-center gap-2"
                                        >
                                            <RefreshCw size={14} />
                                            إلغاء جميع أجهزة الفرع
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {showResetModal && createPortal(
                <div className="admin-overlay-shell z-[9999] overflow-hidden">
                    <div
                        className="absolute inset-0 bg-black/90 backdrop-blur-md animate-fadeIn"
                        onClick={() => { setShowResetModal(null); setConfirmText(''); }}
                    />
                    <div
                        className={`admin-overlay-panel relative w-full max-w-[420px] rounded-[2rem] border shadow-[0_20px_60px_rgba(0,0,0,0.5)] animate-scaleIn ${isDarkMode ? 'bg-[#121212] border-white/10' : 'bg-white border-black/10'}`}
                    >
                        <div className="p-7 text-center">
                            <div className={`w-16 h-16 rounded-2xl mx-auto mb-6 flex items-center justify-center ${isDarkMode ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 'bg-red-50 text-red-600 border border-red-100'}`}>
                                <ShieldAlert size={30} />
                            </div>
                            <h3 className={`text-xl font-bold mb-3 ${isDarkMode ? 'text-white' : 'text-[#121212]'}`}>
                                تأكيد إلغاء جميع أجهزة الفرع
                            </h3>
                            <p className={`text-sm leading-relaxed mb-6 ${isDarkMode ? 'text-white/60' : 'text-black/60'}`}>
                                سيتم فصل كل أجهزة Mini النشطة لهذا الفرع، وسيحتاج أي جهاز جديد إلى اعتماد إداري قبل الدخول.
                            </p>

                            <div className="space-y-3 mb-8 text-right">
                                <label className={`text-[10px] font-bold uppercase tracking-[0.2em] px-1 ${isDarkMode ? 'text-[#7A7A7A]' : 'text-gray-400'}`}>
                                    أكتب كلمة RESET للتأكيد
                                </label>
                                <input
                                    type="text"
                                    value={confirmText}
                                    onChange={(e) => setConfirmText(e.target.value)}
                                    dir="ltr"
                                    className={`w-full h-12 px-4 border rounded-xl outline-none text-center font-black tracking-[0.3em] transition-all text-sm ${isDarkMode ? 'bg-black border-white/5 text-white focus:border-red-500/40 focus:bg-red-500/5' : 'bg-gray-50 border-black/5 text-[#121212] focus:border-red-500/40 focus:bg-red-50'}`}
                                />
                            </div>

                            <div className="flex gap-3">
                                <button
                                    onClick={() => { setShowResetModal(null); setConfirmText(''); }}
                                    className={`flex-1 h-12 rounded-xl font-bold text-sm transition-all ${isDarkMode ? 'bg-white/5 text-white hover:bg-white/10' : 'bg-gray-100 text-[#121212] hover:bg-gray-200'}`}
                                >
                                    إلغاء
                                </button>
                                <button
                                    onClick={handleReset}
                                    disabled={confirmText !== 'RESET' || submittingKey === `reset-${showResetModal.id}`}
                                    className="flex-1 h-12 rounded-xl font-bold text-sm transition-all bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                >
                                    {submittingKey === `reset-${showResetModal.id}` ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                                    تأكيد
                                </button>
                            </div>

                            <button
                                onClick={() => { setShowResetModal(null); setConfirmText(''); }}
                                className={`absolute top-4 left-4 p-2 rounded-full transition-colors ${isDarkMode ? 'text-white/50 hover:bg-white/5' : 'text-gray-500 hover:bg-gray-100'}`}
                            >
                                <X size={18} />
                            </button>
                        </div>
                    </div>
                </div>,
                document.body,
            )}
        </div>
    );
};

const APPROVAL_PROFILES = {
    DESKTOP_FULL: {
        deviceType: 'DESKTOP',
        accessMode: 'FULL_MINI',
        label: 'جهاز كاشير',
        subtitle: 'كامل الصلاحيات',
        defaultLabel: DEFAULT_DESKTOP_LABEL,
    },
    MOBILE_INVENTORY: {
        deviceType: 'MOBILE',
        accessMode: 'INVENTORY_ONLY',
        label: 'موبايل مخزن',
        subtitle: 'المخزن فقط',
        defaultLabel: DEFAULT_MOBILE_LABEL,
    },
} as const;

function buildInitialEnrollmentForm(enrollment?: PendingMiniDeviceEnrollment): EnrollmentFormState {
    const isDesktopSuggestion = enrollment?.suggested_device_type === 'DESKTOP';
    return {
        pairingCode: '',
        deviceLabel: isDesktopSuggestion ? DEFAULT_DESKTOP_LABEL : DEFAULT_MOBILE_LABEL,
        profile: isDesktopSuggestion ? 'DESKTOP_FULL' : 'MOBILE_INVENTORY',
    };
}

function formatDate(value?: string | null) {
    if (!value) return 'غير متاح';
    return new Date(value).toLocaleString('ar-EG', { dateStyle: 'short', timeStyle: 'short' });
}

function getBranchStatus(activeCount: number, pendingCount: number, legacyCount: number, pendingFinalizationCount: number) {
    if (pendingCount > 0 || pendingFinalizationCount > 0) {
        return {
            label: 'مراجعة مطلوبة',
            accentClass: 'bg-[#E53935]',
            icon: <ShieldAlert size={22} />,
            badgeClass: (isDarkMode: boolean) => isDarkMode
                ? 'bg-[#E53935]/12 text-[#ff8c88]'
                : 'bg-red-50 text-red-600',
            iconClass: (isDarkMode: boolean) => isDarkMode
                ? 'bg-[#E53935]/10 text-[#E53935]'
                : 'bg-[#E53935]/5 text-[#E53935]',
        };
    }

    if (activeCount > 0 && legacyCount === 0) {
        return {
            label: 'مؤمن',
            accentClass: 'bg-emerald-500/80',
            icon: <ShieldCheck size={22} />,
            badgeClass: (isDarkMode: boolean) => isDarkMode
                ? 'bg-emerald-500/12 text-emerald-300'
                : 'bg-emerald-50 text-emerald-700',
            iconClass: (isDarkMode: boolean) => isDarkMode
                ? 'bg-emerald-500/12 text-emerald-300'
                : 'bg-emerald-50 text-emerald-600',
        };
    }

    return {
        label: activeCount > 0 ? 'ترحيل مطلوب' : 'بدون أجهزة',
        accentClass: 'bg-amber-400/80',
        icon: <Monitor size={22} />,
        badgeClass: (isDarkMode: boolean) => isDarkMode
            ? 'bg-amber-400/10 text-amber-300'
            : 'bg-amber-50 text-amber-700',
        iconClass: (isDarkMode: boolean) => isDarkMode
            ? 'bg-amber-400/10 text-amber-300'
            : 'bg-amber-50 text-amber-600',
    };
}

function deviceTypeLabel(type: RegisteredMiniDevice['device_type']) {
    if (type === 'MOBILE') return 'موبايل مخزن';
    if (type === 'TABLET') return 'تابلت';
    return 'جهاز كاشير';
}

function accessModeLabel(mode: RegisteredMiniDevice['access_mode']) {
    return mode === 'INVENTORY_ONLY' ? 'المخزن فقط' : 'كامل الصلاحيات';
}

function credentialStateLabel(state: RegisteredMiniDevice['credential_state']) {
    if (state === 'CREDENTIAL_ENABLED') return 'مؤمن';
    if (state === 'PENDING_FINALIZATION') return 'بانتظار التفعيل';
    if (state === 'REVOKED') return 'ملغي';
    return 'قديم';
}

function credentialStateClasses(state: RegisteredMiniDevice['credential_state']) {
    if (state === 'CREDENTIAL_ENABLED') return 'bg-emerald-500/10 text-emerald-500';
    if (state === 'PENDING_FINALIZATION') return 'bg-blue-500/10 text-blue-400';
    if (state === 'REVOKED') return 'bg-red-500/10 text-red-500';
    return 'bg-amber-500/10 text-amber-500';
}

function proofStateLabel(state: RegisteredMiniDevice['proof_state']) {
    if (state === 'PROOF_ENABLED') return 'إثبات مشفّر';
    if (state === 'PENDING_FINALIZATION') return 'مفتاح بانتظار التفعيل';
    if (state === 'REVOKED') return 'مفتاح ملغي';
    return 'اعتماد فقط';
}

function proofStateClasses(state: RegisteredMiniDevice['proof_state']) {
    if (state === 'PROOF_ENABLED') return 'bg-violet-500/10 text-violet-400';
    if (state === 'PENDING_FINALIZATION') return 'bg-blue-500/10 text-blue-400';
    if (state === 'REVOKED') return 'bg-red-500/10 text-red-500';
    return 'bg-amber-500/10 text-amber-500';
}

function deviceIcon(type: RegisteredMiniDevice['device_type'] | PendingMiniDeviceEnrollment['suggested_device_type']) {
    if (type === 'MOBILE') return <Smartphone size={18} />;
    if (type === 'TABLET') return <Tablet size={18} />;
    return <Monitor size={18} />;
}

const EmptyState = ({
    icon,
    isDarkMode,
    text,
}: {
    icon: React.ReactNode;
    isDarkMode: boolean;
    text: string;
}) => (
    <div className={`flex flex-col items-center justify-center py-6 px-5 rounded-2xl border border-dashed text-center ${isDarkMode ? 'bg-white/[0.01] border-white/5 text-white/35' : 'bg-gray-50/50 border-black/5 text-black/35'}`}>
        <div className={`mb-3 ${isDarkMode ? 'text-white/30' : 'text-black/30'}`}>{icon}</div>
        <p className="text-xs font-bold leading-relaxed">{text}</p>
    </div>
);

const RegisteredDeviceCard: React.FC<{
    branchId: number;
    device: RegisteredMiniDevice;
    isDarkMode: boolean;
    isSubmitting: boolean;
    isRepairing: boolean;
    onRevoke: (branchId: number, deviceId: number | null) => void;
    onRePair: (branchId: number, deviceId: number | null) => void;
}> = ({
    branchId,
    device,
    isDarkMode,
    isSubmitting,
    isRepairing,
    onRevoke,
    onRePair,
}) => (
    <div className={`p-4 rounded-2xl border ${isDarkMode ? 'bg-white/[0.02] border-white/5' : 'bg-gray-50 border-black/5'}`}>
        <div className="flex items-start justify-between gap-3">
            <div className="text-right">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className={`w-9 h-9 rounded-xl flex items-center justify-center ${isDarkMode ? 'bg-white/5 text-white/70' : 'bg-white text-black/60 border border-black/5'}`}>
                        {deviceIcon(device.device_type)}
                    </span>
                    <div>
                        <p className={`text-sm font-bold ${isDarkMode ? 'text-white' : 'text-[#121212]'}`}>
                            {device.device_label || deviceTypeLabel(device.device_type)}
                        </p>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${device.is_active ? 'bg-emerald-500/10 text-emerald-500' : 'bg-white/10 text-white/40'}`}>
                                {device.is_active ? 'نشط' : 'تم إلغاء الجهاز'}
                            </span>
                            <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${isDarkMode ? 'bg-white/5 text-white/60' : 'bg-black/5 text-black/60'}`}>
                                {accessModeLabel(device.access_mode)}
                            </span>
                            <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${credentialStateClasses(device.credential_state)}`}>
                                {credentialStateLabel(device.credential_state)}
                            </span>
                            <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full ${proofStateClasses(device.proof_state)}`}>
                                {proofStateLabel(device.proof_state)}
                            </span>
                        </div>
                    </div>
                </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap justify-end">
                <button
                    onClick={() => onRePair(branchId, device.id)}
                    disabled={isRepairing || isSubmitting}
                    className="h-10 px-3 rounded-xl border border-amber-500/25 text-amber-500 hover:bg-amber-500 hover:text-white transition-all text-xs font-bold flex items-center gap-2 disabled:opacity-50"
                >
                    {isRepairing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                    {device.credential_state === 'LEGACY' ? 'ترقية آمنة' : device.credential_state === 'PENDING_FINALIZATION' ? 'إعادة بدء التفعيل' : 'إعادة ربط'}
                </button>
                {device.is_active && (
                    <button
                        onClick={() => onRevoke(branchId, device.id)}
                        disabled={isSubmitting || isRepairing}
                        className="h-10 px-3 rounded-xl border border-red-500/20 text-red-500 hover:bg-red-500 hover:text-white transition-all text-xs font-bold flex items-center gap-2 disabled:opacity-50"
                    >
                        {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                        إلغاء الجهاز
                    </button>
                )}
            </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4 text-xs">
            <InfoLine label="النوع" value={deviceTypeLabel(device.device_type)} isDarkMode={isDarkMode} />
            <InfoLine label="آخر نشاط" value={formatDate(device.last_seen_at)} isDarkMode={isDarkMode} />
            <InfoLine label="وقت التسجيل" value={formatDate(device.created_at)} isDarkMode={isDarkMode} />
            <InfoLine label="النظام" value={device.device_summary || 'Unknown Device'} isDarkMode={isDarkMode} />
            <InfoLine label="مهلة إعادة الربط" value={formatDate(device.repair_expires_at)} isDarkMode={isDarkMode} />
            <InfoLine label="تسجيل مفتاح الإثبات" value={formatDate(device.proof_key_registered_at)} isDarkMode={isDarkMode} />
            <InfoLine label="آخر إثبات ناجح" value={formatDate(device.last_proof_verified_at)} isDarkMode={isDarkMode} />
            <InfoLine label="إصدار مفتاح الإثبات" value={device.proof_key_version ? String(device.proof_key_version) : 'غير متاح'} isDarkMode={isDarkMode} />
        </div>

        <div className={`mt-3 pt-3 border-t text-[11px] ${isDarkMode ? 'border-white/5 text-white/35' : 'border-black/5 text-black/35'}`}>
            <div className="flex items-center gap-2">
                <Globe size={12} />
                <span dir="ltr">{device.last_seen_ip || 'IP غير متاح'}</span>
            </div>
            <div className="mt-1 break-all" dir="ltr">{device.device_id}</div>
        </div>
    </div>
);

const PendingEnrollmentCard: React.FC<{
    branchId: number;
    enrollment: PendingMiniDeviceEnrollment;
    form: EnrollmentFormState;
    isDarkMode: boolean;
    isApproving: boolean;
    isRejecting: boolean;
    onChange: (enrollmentId: number, field: keyof EnrollmentFormState, value: string) => void;
    onApprove: (branchId: number, enrollment: PendingMiniDeviceEnrollment) => void;
    onReject: (branchId: number, enrollmentId: number) => void;
}> = ({
    branchId,
    enrollment,
    form,
    isDarkMode,
    isApproving,
    isRejecting,
    onChange,
    onApprove,
    onReject,
}) => (
    <div className={`p-4 rounded-2xl border ${isDarkMode ? 'bg-[#E53935]/5 border-[#E53935]/15' : 'bg-red-50 border-red-100'}`}>
        <div className="flex items-start justify-between gap-3">
            <div className="text-right">
                <div className="flex items-center gap-2">
                    <span className={`w-9 h-9 rounded-xl flex items-center justify-center ${isDarkMode ? 'bg-[#E53935]/10 text-[#E53935]' : 'bg-white text-[#E53935] border border-red-100'}`}>
                        {deviceIcon(enrollment.suggested_device_type)}
                    </span>
                    <div>
                        <p className={`text-sm font-bold ${isDarkMode ? 'text-white' : 'text-[#121212]'}`}>
                            طلب تسجيل جهاز جديد
                        </p>
                        <p className={`text-xs mt-1 ${isDarkMode ? 'text-white/55' : 'text-black/55'}`}>
                            {enrollment.device_summary || 'Unknown Device'}
                        </p>
                    </div>
                </div>
            </div>
            <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-[#E53935]/10 text-[#E53935]">
                قيد الانتظار
            </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4 text-xs">
            <InfoLine label="آخر طلب" value={formatDate(enrollment.created_at)} isDarkMode={isDarkMode} />
            <InfoLine label="انتهاء الرمز" value={formatDate(enrollment.expires_at)} isDarkMode={isDarkMode} />
        </div>

        <div className={`mt-3 pt-3 border-t space-y-3 ${isDarkMode ? 'border-white/5' : 'border-black/5'}`}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="space-y-2 text-right">
                    <span className={`text-[11px] font-bold ${isDarkMode ? 'text-white/60' : 'text-black/60'}`}>رمز تسجيل الجهاز</span>
                    <input
                        type="text"
                        dir="ltr"
                        value={form.pairingCode}
                        onChange={(e) => onChange(enrollment.id, 'pairingCode', e.target.value.toUpperCase())}
                        className={`w-full h-11 px-4 rounded-xl border outline-none font-mono tracking-[0.2em] text-center ${isDarkMode ? 'bg-black border-white/10 text-white focus:border-[#E53935]/50' : 'bg-white border-black/10 text-[#121212] focus:border-[#E53935]/50'}`}
                        placeholder="A7K4-P2"
                    />
                </label>
                <label className="space-y-2 text-right">
                    <span className={`text-[11px] font-bold ${isDarkMode ? 'text-white/60' : 'text-black/60'}`}>اسم الجهاز</span>
                    <input
                        type="text"
                        value={form.deviceLabel}
                        onChange={(e) => onChange(enrollment.id, 'deviceLabel', e.target.value)}
                        className={`w-full h-11 px-4 rounded-xl border outline-none ${isDarkMode ? 'bg-black border-white/10 text-white focus:border-[#E53935]/50' : 'bg-white border-black/10 text-[#121212] focus:border-[#E53935]/50'}`}
                    />
                </label>
            </div>

            <label className="space-y-2 text-right block">
                <span className={`text-[11px] font-bold ${isDarkMode ? 'text-white/60' : 'text-black/60'}`}>نوع الجهاز المعتمد</span>
                <select
                    value={form.profile}
                    onChange={(e) => {
                        const nextProfile = e.target.value as ApprovalProfileKey;
                        onChange(enrollment.id, 'profile', nextProfile);
                        onChange(enrollment.id, 'deviceLabel', APPROVAL_PROFILES[nextProfile].defaultLabel);
                    }}
                    className={`w-full h-11 px-4 rounded-xl border outline-none ${isDarkMode ? 'bg-black border-white/10 text-white' : 'bg-white border-black/10 text-[#121212]'}`}
                >
                    <option value="MOBILE_INVENTORY">موبايل مخزن - المخزن فقط</option>
                    <option value="DESKTOP_FULL">جهاز كاشير - كامل الصلاحيات</option>
                </select>
            </label>

            <div className={`text-[11px] break-all ${isDarkMode ? 'text-white/35' : 'text-black/35'}`} dir="ltr">
                {enrollment.device_id}
            </div>

            <div className="flex gap-3">
                <button
                    onClick={() => onApprove(branchId, enrollment)}
                    disabled={isApproving || !form.pairingCode.trim() || !form.deviceLabel.trim()}
                    className="flex-1 h-11 bg-[#E53935] hover:bg-[#ff4040] text-white rounded-xl font-bold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                    {isApproving ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />}
                    اعتماد الجهاز
                </button>
                <button
                    onClick={() => onReject(branchId, enrollment.id)}
                    disabled={isRejecting}
                    className={`flex-1 h-11 rounded-xl font-bold text-sm transition-all border ${isDarkMode ? 'border-white/10 text-white hover:bg-white/5' : 'border-black/10 text-[#121212] hover:bg-black/5'} disabled:opacity-50 flex items-center justify-center gap-2`}
                >
                    {isRejecting ? <Loader2 size={15} className="animate-spin" /> : <X size={15} />}
                    رفض
                </button>
            </div>
        </div>
    </div>
);

const InfoLine = ({
    label,
    value,
    isDarkMode,
}: {
    label: string;
    value: string;
    isDarkMode: boolean;
}) => (
    <div className={`p-3 rounded-xl border ${isDarkMode ? 'bg-white/[0.02] border-white/5' : 'bg-white border-black/5'}`}>
        <p className={`text-[10px] font-bold mb-1 ${isDarkMode ? 'text-white/40' : 'text-black/40'}`}>{label}</p>
        <p className={`text-xs font-bold leading-relaxed ${isDarkMode ? 'text-white' : 'text-[#121212]'}`}>{value}</p>
    </div>
);

export default BranchManagement;
