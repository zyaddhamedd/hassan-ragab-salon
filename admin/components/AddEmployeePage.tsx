import React, { useState, useRef, useEffect } from 'react';
import { User, Phone, Briefcase, MapPin, Calendar, Activity, UploadCloud, FileText, CheckCircle2, ChevronLeft, Save, X, Trash2, Eye, Download, CreditCard, Loader2 } from 'lucide-react';
import { Employee, EmployeeRole, EmployeeStatus, EmployeeDocument, ROLE_LABELS } from '../types';
import adminApi from '../api/client';
import { formatDate, getTodayISO } from '../utils/dateFormatter';

interface AddEmployeePageProps {
  isDarkMode: boolean;
  onSave: (employee: Employee) => void;
  onCancel: () => void;
  employeeToEdit?: Employee | null;
}

const AddEmployeePage: React.FC<AddEmployeePageProps> = ({ isDarkMode, onSave, onCancel, employeeToEdit }) => {
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    role: 'BARBER' as EmployeeRole,
    branch_id: '', // Store ID directly
    branch_name: '', // For display or fallback
    hireDate: getTodayISO(),
    status: 'نشط' as EmployeeStatus,
    baseSalary: '',
    notes: ''
  });

  const [branchesList, setBranchesList] = useState<{ id: number; name: string }[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [documents, setDocuments] = useState<EmployeeDocument[]>([]);
  const photoInputRef = useRef<HTMLInputElement>(null);

  // Document Upload Logic
  const [activeDocType, setActiveDocType] = useState<EmployeeDocument['type'] | null>(null);
  const docInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Fetch Branches (Existing logic)
    const fetchBranches = async () => {
      try {
        const res = await adminApi.get('/branches');
        const data = res.data;
        setBranchesList(data);

        // If create mode (no employeeToEdit), select first branch default
        if (data.length > 0 && !employeeToEdit) {
          setFormData(prev => ({
            ...prev,
            branch_id: data[0].id.toString(),
            branch_name: data[0].name
          }));
        }
      } catch (err) {
        console.error("Failed to fetch branches", err);
      }
    };
    fetchBranches();
  }, [employeeToEdit]);

  // Handle Edit Mode Prefill
  useEffect(() => {
    if (employeeToEdit) {
      setFormData({
        name: employeeToEdit.name,
        phone: employeeToEdit.phone,
        role: employeeToEdit.role,
        branch_id: employeeToEdit.branch_id || '',
        branch_name: employeeToEdit.branch,
        hireDate: employeeToEdit.employmentDate,
        status: (employeeToEdit.status === 'نشط' || employeeToEdit.status === 'موقوف') ? employeeToEdit.status : 'نشط',
        baseSalary: employeeToEdit.baseSalary?.toString() || '',
        notes: ''
      });

      if (employeeToEdit.photoUrl) {
        setPhotoPreview(employeeToEdit.photoUrl);
      }
      if (employeeToEdit.documents) {
        setDocuments(employeeToEdit.documents);
      }
    }
  }, [employeeToEdit]);

  // Sync branch ID when branches list loads
  useEffect(() => {
    if (employeeToEdit && branchesList.length > 0) {
      // Prioritize ID match
      if (employeeToEdit.branch_id) {
        const matched = branchesList.find(b => b.id.toString() === employeeToEdit.branch_id);
        if (matched) {
          setFormData(prev => ({ ...prev, branch_id: matched.id.toString(), branch_name: matched.name }));
          return;
        }
      }

      // Fallback to name match
      const matched = branchesList.find(b => b.name === employeeToEdit.branch);
      if (matched) {
        setFormData(prev => ({ ...prev, branch_id: matched.id.toString(), branch_name: matched.name }));
      }
    }
  }, [branchesList, employeeToEdit]);

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setPhotoFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setPhotoPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const triggerDocUpload = (type: EmployeeDocument['type']) => {
    setActiveDocType(type);
    setTimeout(() => {
      docInputRef.current?.click();
    }, 0);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && activeDocType) {
      const mockUrl = URL.createObjectURL(file);
      const newDoc: EmployeeDocument & { file?: File } = {
        id: Math.random().toString(36).substr(2, 9),
        name: file.name,
        type: activeDocType,
        uploadDate: formatDate(new Date()),
        fileUrl: mockUrl,
        size: `${(file.size / 1024 / 1024).toFixed(2)} MB`,
        file: file // Store the actual file
      };

      setDocuments(prev => {
        const filtered = prev.filter(d => d.type !== activeDocType);
        return [...filtered, newDoc];
      });
    }
    if (docInputRef.current) docInputRef.current.value = '';
    setActiveDocType(null);
  };

  const handleSave = async () => {
    if (!formData.name || !formData.phone || !formData.branch_id) return;

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      let payload: any;
      let headers = {};

      const hasDocuments = documents.some(d => (d as any).file);
      const isEdit = !!employeeToEdit;

      if (photoFile || hasDocuments) {
        // Use FormData
        const formDataPayload = new FormData();
        formDataPayload.append('full_name', formData.name);
        formDataPayload.append('phone', formData.phone);
        formDataPayload.append('branch_id', formData.branch_id);
        formDataPayload.append('role', formData.role);
        formDataPayload.append('base_salary', formData.baseSalary || '0');
        formDataPayload.append('is_active', formData.status === 'نشط' ? 'true' : 'false');
        formDataPayload.append('status', formData.status === 'نشط' ? 'ACTIVE' : 'SUSPENDED'); // Enum for backend

        if (photoFile) {
          formDataPayload.append('image', photoFile);
        }

        documents.forEach((doc, index) => {
          const fileDoc = doc as (EmployeeDocument & { file?: File });
          if (fileDoc.file) {
            formDataPayload.append(`document_${index}_type`, doc.type);
            formDataPayload.append(`document_${index}_file`, fileDoc.file);
          }
        });

        payload = formDataPayload;
      } else {
        // Use JSON
        payload = {
          full_name: formData.name,
          phone: formData.phone,
          branch_id: parseInt(formData.branch_id),
          role: formData.role,
          base_salary: parseFloat(formData.baseSalary) || 0,
          is_active: formData.status === 'نشط',
          status: formData.status === 'نشط' ? 'ACTIVE' : 'SUSPENDED'
        };
      }

      let res;
      if (isEdit) {
        // UPDATE
        res = await adminApi.put(`/employees/${employeeToEdit.id}`, payload, { headers });
      } else {
        // CREATE
        res = await adminApi.post('/employees', payload, { headers });
      }

      const saved = res.data;

      const savedEmployee: Employee = {
        id: saved.id.toString(),
        internalId: `EMP-${saved.id}`,
        name: saved.full_name,
        phone: saved.phone,
        role: formData.role,
        branch: saved.branch_name || formData.branch_name,
        status: formData.status,
        employmentDate: formData.hireDate,
        baseSalary: saved.base_salary,
        photoUrl: saved.image_url ? `${import.meta.env.VITE_API_URL || 'http://localhost:5001'}/uploads/${saved.image_url.replace(/\\/g, '/')}` : undefined,
        lastNetPaid: employeeToEdit?.lastNetPaid || 0,
        lastPayDate: employeeToEdit?.lastPayDate || '---',
        avatarColor: employeeToEdit?.avatarColor || '#E53935',
        transferHistory: [],
        documents: saved.documents || documents,
        createdAt: saved.created_at
      };

      onSave(savedEmployee);

    } catch (err: any) {
      console.error("Failed to save employee", err);
      setErrorMsg(err.response?.data?.error || "حدث خطأ أثناء حفظ الموظف");
    } finally {
      setIsSubmitting(false);
    }
  };

  const roles: EmployeeRole[] = ['BARBER', 'CASHIER', 'ADMIN', 'ASSISTANT', 'STAFF'];
  // Branches are now dynamic from branchesList


  const documentTypes: EmployeeDocument['type'][] = ['بطاقة شخصية', 'فيش وتشبيه', 'مستندات إدارية أخرى'];

  return (
    <div className="admin-page-shell space-y-12 animate-fade-in-up">

      {/* HEADER SECTION */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-1.5 h-8 bg-[#E53935] rounded-full"></div>
            <h2 className={`text-2xl sm:text-3xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{employeeToEdit ? 'تعديل بيانات الموظف' : 'إضافة موظف جديد'}</h2>
          </div>
          <p className={`${isDarkMode ? 'text-gray-400' : 'text-gray-500'} text-xs font-bold uppercase tracking-widest opacity-60`}>
            {employeeToEdit ? 'تحديث البيانات والمعلومات الوظيفية' : 'إدخال بيانات الكادر البشري الجديد للمنظومة'}
          </p>
        </div>
        <button
          onClick={onCancel}
          className={`w-full sm:w-auto px-6 py-3 rounded-2xl text-[10px] font-bold uppercase tracking-widest flex items-center justify-center gap-2 border transition-all ${isDarkMode ? 'border-white/10 text-gray-400 hover:bg-white/5' : 'border-black/10 text-gray-500 hover:bg-black/5'
            }`}
        >
          <X size={14} /> تراجع
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">

        {/* LEFT COLUMN: BASIC INFO & NOTES */}
        <div className="xl:col-span-2 space-y-10">

          {/* SECTION 1: BASIC INFORMATION */}
          <div className={`p-6 sm:p-10 rounded-[2.5rem] border theme-transition ${isDarkMode ? 'bg-[#161616] border-white/5 luxury-shadow' : 'bg-white border-black/5 luxury-shadow-light'}`}>
            <div className="flex items-center gap-3 mb-8 opacity-40">
              <User size={16} />
              <h3 className="text-[10px] font-bold uppercase tracking-[0.2em]">المعلومات الأساسية</h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-8">
              <div className="space-y-2">
                <label className={`text-[10px] font-bold uppercase tracking-widest mr-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>الاسم الكامل</label>
                <div className="relative">
                  <User size={16} className={`absolute right-4 top-1/2 -translate-y-1/2 ${isDarkMode ? 'text-gray-600' : 'text-gray-400'}`} />
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="أدخل اسم الموظف..."
                    className={`w-full pr-12 pl-4 py-4 rounded-2xl border text-sm font-bold outline-none transition-all ${isDarkMode ? 'bg-[#0B0B0B] border-white/5 text-white focus:border-[#E53935]/40' : 'bg-gray-50 border-gray-200 text-gray-900 focus:border-[#E53935]/40'
                      }`}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className={`text-[10px] font-bold uppercase tracking-widest mr-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>رقم الهاتف</label>
                <div className="relative">
                  <Phone size={16} className={`absolute right-4 top-1/2 -translate-y-1/2 ${isDarkMode ? 'text-gray-600' : 'text-gray-400'}`} />
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    placeholder="01xxxxxxxxx"
                    className={`w-full pr-12 pl-4 py-4 rounded-2xl border text-sm font-bold outline-none transition-all ${isDarkMode ? 'bg-[#0B0B0B] border-white/5 text-white focus:border-[#E53935]/40' : 'bg-gray-50 border-gray-200 text-gray-900 focus:border-[#E53935]/40'
                      }`}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className={`text-[10px] font-bold uppercase tracking-widest mr-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>المسمى الوظيفي</label>
                <div className="relative">
                  <Briefcase size={16} className={`absolute right-4 top-1/2 -translate-y-1/2 ${isDarkMode ? 'text-gray-600' : 'text-gray-400'}`} />
                  <select
                    value={formData.role}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value as EmployeeRole })}
                    className={`w-full pr-12 pl-4 py-4 rounded-2xl border text-sm font-bold outline-none transition-all appearance-none ${isDarkMode ? 'bg-[#0B0B0B] border-white/5 text-white focus:border-[#E53935]/40' : 'bg-gray-50 border-gray-200 text-gray-900 focus:border-[#E53935]/40'
                      }`}
                  >
                    {roles.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <label className={`text-[10px] font-bold uppercase tracking-widest mr-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>الفرع الرئيسي</label>
                <div className="relative">
                  <MapPin size={16} className={`absolute right-4 top-1/2 -translate-y-1/2 ${isDarkMode ? 'text-gray-600' : 'text-gray-400'}`} />
                  <select
                    value={formData.branch_id}
                    onChange={(e) => {
                      const selectedId = e.target.value;
                      const selectedBranch = branchesList.find(b => b.id.toString() === selectedId);
                      setFormData({
                        ...formData,
                        branch_id: selectedId,
                        branch_name: selectedBranch ? selectedBranch.name : ''
                      });
                    }}
                    className={`w-full pr-12 pl-4 py-4 rounded-2xl border text-sm font-bold outline-none transition-all appearance-none ${isDarkMode ? 'bg-[#0B0B0B] border-white/5 text-white focus:border-[#E53935]/40' : 'bg-gray-50 border-gray-200 text-gray-900 focus:border-[#E53935]/40'
                      }`}
                  >
                    {branchesList.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <label className={`text-[10px] font-bold uppercase tracking-widest mr-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>تاريخ التعيين</label>
                <div className="relative">
                  <Calendar size={16} className={`absolute right-4 top-1/2 -translate-y-1/2 ${isDarkMode ? 'text-gray-600' : 'text-gray-400'}`} />
                  <input
                    type="date"
                    value={formData.hireDate}
                    onChange={(e) => setFormData({ ...formData, hireDate: e.target.value })}
                    className={`w-full pr-12 pl-4 py-4 rounded-2xl border text-sm font-bold outline-none transition-all ${isDarkMode ? 'bg-[#0B0B0B] border-white/5 text-white focus:border-[#E53935]/40' : 'bg-gray-50 border-gray-200 text-gray-900 focus:border-[#E53935]/40'
                      }`}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className={`text-[10px] font-bold uppercase tracking-widest mr-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>حالة الموظف</label>
                <div className="relative">
                  <Activity size={16} className={`absolute right-4 top-1/2 -translate-y-1/2 ${isDarkMode ? 'text-gray-600' : 'text-gray-400'}`} />
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value as EmployeeStatus })}
                    className={`w-full pr-12 pl-4 py-4 rounded-2xl border text-sm font-bold outline-none transition-all appearance-none ${isDarkMode ? 'bg-[#0B0B0B] border-white/5 text-white focus:border-[#E53935]/40' : 'bg-gray-50 border-gray-200 text-gray-900 focus:border-[#E53935]/40'
                      }`}
                  >
                    <option value="نشط">نشط</option>
                    <option value="موقوف">موقوف</option>
                  </select>
                </div>
              </div>

              {/* BASE SALARY INPUT */}
              <div className="space-y-2">
                <label className={`text-[10px] font-bold uppercase tracking-widest mr-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>الراتب الأساسي</label>
                <div className="relative">
                  <CreditCard size={16} className={`absolute right-4 top-1/2 -translate-y-1/2 ${isDarkMode ? 'text-gray-600' : 'text-gray-400'}`} />
                  <input
                    type="number"
                    value={formData.baseSalary}
                    onChange={(e) => setFormData({ ...formData, baseSalary: e.target.value })}
                    placeholder="0.00"
                    className={`w-full pr-12 pl-16 py-4 rounded-2xl border text-sm font-bold outline-none transition-all ${isDarkMode ? 'bg-[#0B0B0B] border-white/5 text-white focus:border-[#E53935]/40' : 'bg-gray-50 border-gray-200 text-gray-900 focus:border-[#E53935]/40'
                      }`}
                  />
                  <span className={`absolute left-4 top-1/2 -translate-y-1/2 text-[10px] font-bold ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>EGP</span>
                </div>
              </div>
            </div>
          </div>

          {/* SECTION 4: INTERNAL NOTES */}
          <div className={`p-6 sm:p-10 rounded-[2.5rem] border theme-transition ${isDarkMode ? 'bg-[#161616] border-white/5 luxury-shadow' : 'bg-white border-black/5 luxury-shadow-light'}`}>
            <div className="flex items-center gap-3 mb-6 opacity-40">
              <FileText size={16} />
              <h3 className="text-[10px] font-bold uppercase tracking-[0.2em]">ملاحظات داخلية</h3>
            </div>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="اكتب أي ملاحظات إدارية هنا..."
              rows={4}
              className={`w-full p-6 rounded-2xl border text-sm font-bold outline-none transition-all resize-none ${isDarkMode ? 'bg-[#0B0B0B] border-white/5 text-white focus:border-[#E53935]/40' : 'bg-gray-50 border-gray-200 text-gray-900 focus:border-[#E53935]/40'
                }`}
            />
          </div>
        </div>

        {/* RIGHT COLUMN: PHOTO & DOCUMENTS */}
        <div className="space-y-10">
          {/* Same as before... */}
          {/* SECTION 2: PROFILE PHOTO */}
          <div className={`p-6 sm:p-10 rounded-[2.5rem] border theme-transition ${isDarkMode ? 'bg-[#161616] border-white/5 luxury-shadow' : 'bg-white border-black/5 luxury-shadow-light'}`}>
            <div className="flex flex-col items-center text-center">
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-6">الصورة الشخصية</span>

              <div className="relative group">
                {photoPreview ? (
                  <div className="w-32 h-32 rounded-[2.5rem] overflow-hidden border-4 border-[#E53935] shadow-2xl relative">
                    <img src={photoPreview} className="w-full h-full object-cover" alt="Preview" />
                    <button
                      onClick={() => setPhotoPreview(null)}
                      className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"
                    >
                      <Trash2 className="text-white" size={24} />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => photoInputRef.current?.click()}
                    className={`w-32 h-32 rounded-[2.5rem] border-2 border-dashed flex flex-col items-center justify-center gap-2 transition-all group ${isDarkMode ? 'border-white/10 hover:border-[#E53935]/40 hover:bg-white/5' : 'border-gray-200 hover:border-[#E53935]/40 hover:bg-black/5'
                      }`}
                  >
                    <UploadCloud size={24} className="opacity-20 group-hover:opacity-100 group-hover:text-[#E53935] transition-all" />
                    <span className="text-[8px] font-bold uppercase tracking-widest opacity-40">رفع صورة</span>
                  </button>
                )}
                <input ref={photoInputRef} type="file" hidden accept="image/*" onChange={handlePhotoUpload} />
              </div>
              <p className="text-[8px] font-bold text-gray-500 uppercase tracking-widest mt-4">اختياري: يمكن التخطي</p>
            </div>
          </div>

          {/* SECTION 3: DOCUMENTS */}
          <div className={`p-6 sm:p-10 rounded-[2.5rem] border theme-transition ${isDarkMode ? 'bg-[#161616] border-white/5 luxury-shadow' : 'bg-white border-black/5 luxury-shadow-light'}`}>
            <div className="flex items-center gap-3 mb-8 opacity-40">
              <FileText size={16} />
              <h3 className="text-[10px] font-bold uppercase tracking-[0.2em]">ملفات الموظف</h3>
            </div>

            <div className="space-y-1">
              {documentTypes.map((type) => {
                const uploadedDoc = documents.find(d => d.type === type);
                return (
                  <div key={type} className={`flex items-center justify-between py-4 border-b last:border-0 ${isDarkMode ? 'border-white/5' : 'border-black/5'}`}>
                    <div className="flex items-center gap-3">
                      <div className={`${uploadedDoc ? 'text-[#E6D690]' : 'text-gray-500 opacity-20'}`}>
                        <FileText size={18} />
                      </div>
                      <div className="flex flex-col">
                        <span className={`text-[10px] sm:text-[11px] font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{type}</span>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <div className={`w-1 h-1 rounded-full ${uploadedDoc ? 'bg-green-500' : 'bg-gray-500/30'}`}></div>
                          <span className="text-[7px] font-bold opacity-40 uppercase tracking-widest">{uploadedDoc ? uploadedDoc.name.substring(0, 20) + (uploadedDoc.name.length > 20 ? '...' : '') : 'بانتظار الرفع'}</span>
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => triggerDocUpload(type)}
                      className={`px-3 py-1.5 rounded-lg text-[8px] font-bold uppercase tracking-widest transition-all border ${uploadedDoc
                        ? (isDarkMode ? 'bg-white/5 border-white/5 text-gray-300 hover:bg-white/10' : 'bg-gray-100 border-black/5 text-gray-700 hover:bg-gray-200')
                        : (isDarkMode ? 'bg-[#E53935]/10 border-[#E53935]/20 text-[#E53935] hover:bg-[#E53935]/20' : 'bg-[#E53935]/5 border-[#E53935]/10 text-[#E53935] hover:bg-[#E53935]/10')
                        }`}
                    >
                      {uploadedDoc ? 'استبدال' : 'رفع'}
                    </button>
                  </div>
                );
              })}
              {/* Hidden File Input for Documents */}
              <input
                type="file"
                ref={docInputRef}
                hidden
                accept=".pdf,.jpg,.jpeg,.png"
                onChange={handleFileChange}
              />
            </div>
          </div>

        </div>
      </div>

      {/* ERROR MESSAGE */}
      {errorMsg && (
        <div className="flex items-center justify-center p-4">
          <div className="bg-red-500/10 border border-red-500/20 text-red-500 px-6 py-3 rounded-xl text-sm font-bold flex items-center gap-2">
            <X size={16} />
            {errorMsg}
          </div>
        </div>
      )}

      {/* FINAL ACTION BAR */}
      <div className="flex flex-col sm:flex-row justify-center gap-4 border-t border-white/5 pt-12">
        <button
          onClick={onCancel}
          disabled={isSubmitting}
          className={`order-2 sm:order-1 w-full sm:w-auto px-12 py-4 rounded-2xl text-xs font-bold uppercase tracking-widest border transition-all ${isDarkMode ? 'border-white/10 text-white hover:bg-white/5' : 'border-black/10 text-gray-900 hover:bg-black/5'
            }`}
        >
          إلغاء العملية
        </button>
        <button
          onClick={handleSave}
          disabled={!formData.name || !formData.phone || isSubmitting}
          className={`order-1 sm:order-2 w-full sm:w-auto px-20 py-4 rounded-2xl text-xs font-bold uppercase tracking-widest transition-all shadow-xl flex items-center justify-center gap-3 ${(!formData.name || !formData.phone || isSubmitting)
            ? 'bg-gray-500/20 text-gray-500 cursor-not-allowed border border-white/5'
            : 'bg-[#E53935] hover:bg-[#FF3B30] text-white shadow-red-900/30 active:scale-95'
            }`}
        >
          {isSubmitting ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
          {isSubmitting ? 'جاري الحفظ...' : (employeeToEdit ? 'حفظ التعديلات' : 'حفظ الموظف')}
        </button>
      </div>

      <footer className="mt-16 text-center opacity-30">
        <p className={`text-[9px] font-bold uppercase tracking-[0.5em] ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
          THE SECRET MEN CLUB • HR ONBOARDING v1.0
        </p>
      </footer>
    </div>
  );
};

export default AddEmployeePage;
