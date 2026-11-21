
import React from 'react';
import {
    Printer,
    Calendar,
    User,
    Scissors,
    TrendingUp,
    Clock,
    DollarSign,
    MapPin,
    Building2,
    ShieldCheck,
    AlertCircle
} from 'lucide-react';
import Logo from './Logo';
import { formatDate } from '../utils/dateFormatter';

export interface ReportData {
    meta: {
        generated_at: string;
        period: {
            start: string;
            end: string;
        };
        employee: {
            name: string;
            role: string;
            branch: string;
            id: number;
        };
    };
    summary: {
        total_services: number;
        total_revenue: number;
        total_commission: number;
        net_pay_variable: number;
        total_hours: number;
    };
    services_breakdown: Array<{
        type: string;
        count: number;
        revenue: number;
        average_value: number;
    }>;
    branch_performance: Array<{
        branch: string;
        count: number;
        revenue: number;
    }>;
    attendance: {
        days_worked: number;
        total_hours: number;
        late_days: number;
        absence_days: number;
    };
    financials: {
        base_salary: number;
        total_commission: number;
        total_overtime: number;
        total_deductions: number;
        total_loans: number;
        final_net_with_salary: number;
    };
}

interface EmployeeReportProps {
    data: ReportData;
    onClose: () => void;
}

const EmployeeReport: React.FC<EmployeeReportProps> = ({ data, onClose }) => {

    const handlePrint = () => {
        window.print();
    };

    return (
        <div className="admin-overlay-shell admin-overlay-shell--scroll z-[200] bg-black/95" dir="rtl">
            <div className="absolute inset-0 request-print-close" onClick={onClose}></div>

            <div className="relative w-full max-w-[210mm] bg-white text-black min-h-[297mm] p-12 sm:p-16 animate-scale-in font-['Tajawal'] print:p-0 print:m-0 print:shadow-none shadow-2xl rounded-sm print:w-full print:max-w-none print:absolute print:inset-0 print:h-auto">

                {/* Print Controls (Hidden when printing) */}
                <div className="absolute top-8 left-8 flex gap-4 print:hidden">
                    <button
                        onClick={handlePrint}
                        className="bg-[#E53935] text-white p-4 rounded-full shadow-2xl hover:scale-110 transition-transform flex items-center gap-2"
                    >
                        <Printer size={20} />
                        <span className="text-xs font-bold uppercase tracking-widest hidden sm:inline">طباعة التقرير</span>
                    </button>
                    <button
                        onClick={onClose}
                        className="bg-gray-100 text-gray-400 p-4 rounded-full shadow-lg hover:bg-gray-200"
                    >
                        <AlertCircle size={20} />
                    </button>
                </div>

                {/* REPORT HEADER */}
                <div className="flex flex-col items-center mb-12 border-b-2 border-gray-900 pb-8">
                    <Logo size="lg" className="mb-4 text-black" />
                    <h1 className="text-3xl font-black uppercase tracking-tight text-gray-900 mb-2">تقرير الأداء الشامل</h1>
                    <div className="flex items-center gap-4 text-[10px] font-bold uppercase tracking-widest text-gray-500">
                        <span>تاريخ التقرير: {formatDate(data.meta.generated_at)}</span>
                        <span>•</span>
                        <span>فترة التقرير: {data.meta.period.start} - {data.meta.period.end}</span>
                    </div>
                </div>

                {/* EMPLOYEE INFO */}
                <div className="bg-gray-50 p-6 rounded-2xl mb-10 border border-gray-100">
                    <div className="grid grid-cols-3 gap-8 text-center sm:text-right">
                        <div>
                            <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest block mb-1">الموظف</span>
                            <span className="text-lg font-bold text-gray-900">{data.meta.employee.name}</span>
                        </div>
                        <div>
                            <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest block mb-1">المنصب</span>
                            <span className="text-lg font-bold text-gray-900">{data.meta.employee.role}</span>
                        </div>
                        <div>
                            <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest block mb-1">الفرع الأساسي</span>
                            <span className="text-lg font-bold text-gray-900">{data.meta.employee.branch}</span>
                        </div>
                    </div>
                </div>

                {/* 1. EXECUTIVE SUMMARY */}
                <div className="mb-12">
                    <h2 className="text-sm font-black uppercase tracking-widest mb-6 flex items-center gap-2">
                        <div className="w-1 h-4 bg-[#E53935]"></div>
                        ملخص الأداء العام
                    </h2>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                        <div className="p-4 rounded-xl border border-gray-100 bg-white">
                            <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest block mb-2">إجمالي الخدمات</span>
                            <span className="text-2xl font-black text-gray-900">{data.summary.total_services}</span>
                        </div>
                        <div className="p-4 rounded-xl border border-gray-100 bg-white">
                            <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest block mb-2">ساعات العمل</span>
                            <span className="text-2xl font-black text-gray-900">{data.summary.total_hours} <span className="text-ss opacity-50">ساعة</span></span>
                        </div>
                        <div className="p-4 rounded-xl border border-gray-100 bg-white">
                            <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest block mb-2">إجمالي الإيرادات</span>
                            <span className="text-2xl font-black text-gray-900">{data.summary.total_revenue.toLocaleString()} <span className="text-xs opacity-50">ج.م</span></span>
                        </div>
                        <div className="p-4 rounded-xl border border-gray-100 bg-gray-900 text-white">
                            <span className="text-[9px] font-bold opacity-60 uppercase tracking-widest block mb-2">صافي المستحقات</span>
                            <span className="text-2xl font-black">{data.financials.final_net_with_salary.toLocaleString()} <span className="text-xs opacity-50">ج.م</span></span>
                        </div>
                    </div>
                </div>

                {/* 2. SERVICES BREAKDOWN */}
                <div className="mb-12">
                    <h2 className="text-sm font-black uppercase tracking-widest mb-6 flex items-center gap-2">
                        <div className="w-1 h-4 bg-black"></div>
                        تفاصيل الخدمات المنفذة
                    </h2>
                    <table className="w-full text-right border-collapse">
                        <thead>
                            <tr className="border-b-2 border-gray-900 text-[10px] font-bold uppercase tracking-widest bg-gray-50">
                                <th className="py-3 px-4 rounded-tr-lg text-gray-500">نوع الخدمة</th>
                                <th className="py-3 px-4 text-gray-500">العدد</th>
                                <th className="py-3 px-4 text-gray-500">الإيراد المحقق</th>
                                <th className="py-3 px-4 rounded-tl-lg text-gray-500">متوسط القيمة</th>
                            </tr>
                        </thead>
                        <tbody className="text-xs font-bold divide-y divide-gray-100">
                            {data.services_breakdown.map((service, idx) => (
                                <tr key={idx} className="hover:bg-gray-50">
                                    <td className="py-3 px-4">{service.type}</td>
                                    <td className="py-3 px-4">{service.count}</td>
                                    <td className="py-3 px-4">{service.revenue.toLocaleString()} ج.م</td>
                                    <td className="py-3 px-4 opacity-60">{Math.round(service.average_value).toLocaleString()} ج.م</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                <div className="grid grid-cols-2 gap-12 mb-12">
                    {/* 3. BRANCH PERFORMANCE */}
                    <div>
                        <h2 className="text-sm font-black uppercase tracking-widest mb-6 flex items-center gap-2">
                            <div className="w-1 h-4 bg-black"></div>
                            الأداء حسب الفرع
                        </h2>
                        <div className="space-y-3">
                            {data.branch_performance.map((branch, idx) => (
                                <div key={idx} className="flex items-center justify-between p-3 rounded-lg border border-gray-100">
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 bg-gray-100 rounded-lg"><Building2 size={16} /></div>
                                        <span className="text-xs font-bold">{branch.branch}</span>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-xs font-bold">{branch.count} عملية</div>
                                        <div className="text-[10px] opacity-50 font-bold">{branch.revenue.toLocaleString()} ج.م</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* 4. ATTENDANCE SUMMARY */}
                    <div>
                        <h2 className="text-sm font-black uppercase tracking-widest mb-6 flex items-center gap-2">
                            <div className="w-1 h-4 bg-black"></div>
                            ملخص الحضور والانصراف
                        </h2>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="p-3 bg-green-50 rounded-lg border border-green-100">
                                <span className="text-[9px] font-bold text-green-600 block mb-1">أيام العمل</span>
                                <span className="text-xl font-black text-green-700">{data.attendance.days_worked}</span>
                            </div>
                            <div className="p-3 bg-gray-50 rounded-lg border border-gray-100">
                                <span className="text-[9px] font-bold text-gray-500 block mb-1">ساعات العمل</span>
                                <span className="text-xl font-black text-gray-700">{data.attendance.total_hours}</span>
                            </div>
                            <div className="p-3 bg-red-50 rounded-lg border border-red-100">
                                <span className="text-[9px] font-bold text-red-600 block mb-1">أيام الغياب (مقدر)</span>
                                <span className="text-xl font-black text-red-700">{data.attendance.absence_days}</span>
                            </div>
                            <div className="p-3 bg-gray-50 rounded-lg border border-gray-100">
                                <span className="text-[9px] font-bold text-gray-500 block mb-1">التأخيرات</span>
                                <span className="text-xl font-black text-gray-700">{data.attendance.late_days}</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* 5. FINANCIAL SUMMARY */}
                <div className="mt-auto pt-8 border-t-2 border-gray-900">
                    <h2 className="text-sm font-black uppercase tracking-widest mb-6 flex items-center gap-2">
                        <div className="w-1 h-4 bg-[#E53935]"></div>
                        الملخص المالي النهائي
                    </h2>

                    <div className="grid grid-cols-2 gap-16">
                        <div className="space-y-3">
                            <div className="flex justify-between items-center text-xs font-bold text-gray-500">
                                <span>الراتب الأساسي (الثابت)</span>
                                <span>{data.financials.base_salary.toLocaleString()} ج.م</span>
                            </div>
                            <div className="flex justify-between items-center text-xs font-bold text-green-600">
                                <span>+ عمولات الخدمات</span>
                                <span>{data.financials.total_commission.toLocaleString()} ج.م</span>
                            </div>
                            <div className="flex justify-between items-center text-xs font-bold text-green-600 border-b border-gray-200 pb-3">
                                <span>+ الأوفر تايم</span>
                                <span>{data.financials.total_overtime.toLocaleString()} ج.م</span>
                            </div>
                            <div className="flex justify-between items-center text-sm font-black text-gray-900 pt-1">
                                <span>إجمالي الاستحقاقات</span>
                                <span>{(data.financials.base_salary + data.financials.total_commission + data.financials.total_overtime).toLocaleString()} ج.م</span>
                            </div>
                        </div>

                        <div className="space-y-3">
                            <div className="flex justify-between items-center text-xs font-bold text-red-500">
                                <span>- الخصومات والجزاءات</span>
                                <span>({data.financials.total_deductions.toLocaleString()}) ج.م</span>
                            </div>
                            <div className="flex justify-between items-center text-xs font-bold text-red-500 border-b border-gray-200 pb-3">
                                <span>- السلف المستردة</span>
                                <span>({data.financials.total_loans.toLocaleString()}) ج.م</span>
                            </div>
                            <div className="flex justify-between items-center text-2xl font-black text-[#E53935] pt-1">
                                <span>صافي الراتب</span>
                                <span>{data.financials.final_net_with_salary.toLocaleString()} ج.م</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* FOOTER */}
                <div className="mt-12 pt-6 border-t border-gray-200 flex justify-between items-center text-[9px] font-bold text-gray-400 uppercase tracking-widest">
                    <span>THE SECRET MEN CLUB • CONFIDENTIAL REPORT</span>
                    <span className="font-mono">ID: {data.meta.employee.id}</span>
                </div>
            </div>
        </div>
    );
};

export default EmployeeReport;
