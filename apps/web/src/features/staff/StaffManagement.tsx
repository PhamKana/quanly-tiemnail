import React, { useState } from 'react';
import { Staff, AdminAccount } from '@shared/types';
import { Plus, Search, Edit2, Check, UserPlus, Phone, Briefcase, Percent, DollarSign, Trash2, ShieldAlert, Shield, Lock, Mail, User } from 'lucide-react';

interface StaffManagementProps {
  staffList: Staff[];
  onAddStaff: (newStaff: Omit<Staff, 'id'>) => void;
  onUpdateStaff: (id: string, updatedFields: Partial<Staff>) => void;
  onDeleteStaff: (id: string) => void;
  adminAccounts?: AdminAccount[];
  onAddAdmin?: (newAdmin: { name: string, email: string, password?: string }) => void;
  onUpdateAdmin?: (id: string, updatedFields: Partial<AdminAccount>) => void;
  onDeleteAdmin?: (id: string) => void;
}

export default function StaffManagement({
  staffList,
  onAddStaff,
  onUpdateStaff,
  onDeleteStaff,
  adminAccounts = [],
  onAddAdmin,
  onUpdateAdmin,
  onDeleteAdmin
}: StaffManagementProps) {
  const [subTab, setSubTab] = useState<'technicians' | 'admins'>('technicians');
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);

  // Add form fields for technicians
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState('Thợ Nail Chính (Nail Artist)');
  const [commissionRate, setCommissionRate] = useState(60); // percent
  const [baseSalary, setBaseSalary] = useState(150000);
  const [hourlyRate, setHourlyRate] = useState(30000); // For Support
  const [status, setStatus] = useState<'active' | 'inactive'>('active');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  // Inline editing state for technicians
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editRole, setEditRole] = useState('');
  const [editCommissionRate, setEditCommissionRate] = useState(60);
  const [editBaseSalary, setEditBaseSalary] = useState(150000);
  const [editHourlyRate, setEditHourlyRate] = useState(30000); // For Support
  const [editStatus, setEditStatus] = useState<'active' | 'inactive'>('active');
  const [editUsername, setEditUsername] = useState('');
  const [editPassword, setEditPassword] = useState('');

  // Add form fields for admins
  const [showAddAdminForm, setShowAddAdminForm] = useState(false);
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');

  // Inline editing state for admins
  const [editingAdminId, setEditingAdminId] = useState<string | null>(null);
  const [editAdminName, setEditAdminName] = useState('');
  const [editAdminEmail, setEditAdminEmail] = useState('');
  const [editAdminPassword, setEditAdminPassword] = useState('');

  const [adminSearchTerm, setAdminSearchTerm] = useState('');

  const roleOptions = [
    'Thợ Nail Chính (Nail Artist)',
    'Kỹ thuật viên Gel & Chăm sóc',
    'Chuyên viên Đắp bột & Phục hồi',
    'Thợ Phụ Học Việc',
    'Support'
  ];

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) return;

    onAddStaff({
      name: name.trim(),
      phone: phone.trim(),
      role,
      commissionRate: commissionRate / 100,
      baseSalary: Number(baseSalary),
      hourlyRate: role === 'Support' ? Number(hourlyRate) : undefined,
      status,
      username: username.trim() || phone.trim(),
      password: password.trim() || '1234'
    });

    setName('');
    setPhone('');
    setRole('Thợ Nail Chính (Nail Artist)');
    setCommissionRate(60);
    setBaseSalary(150000);
    setHourlyRate(30000);
    setStatus('active');
    setUsername('');
    setPassword('');
    setShowAddForm(false);
  };

  const handleCreateAdmin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminName.trim() || !adminEmail.trim() || !adminPassword.trim()) return;

    if (onAddAdmin) {
      onAddAdmin({
        name: adminName.trim(),
        email: adminEmail.trim(),
        password: adminPassword.trim()
      });
    }

    setAdminName('');
    setAdminEmail('');
    setAdminPassword('');
    setShowAddAdminForm(false);
  };

  const startEdit = (stf: Staff) => {
    setEditingId(stf.id);
    setEditName(stf.name);
    setEditPhone(stf.phone);
    setEditRole(stf.role);
    setEditCommissionRate(Math.round(stf.commissionRate * 100));
    setEditBaseSalary(stf.baseSalary);
    setEditHourlyRate(stf.hourlyRate || 30000);
    setEditStatus(stf.status);
    setEditUsername(stf.username || '');
    setEditPassword(stf.password || '');
  };

  const startEditAdmin = (admin: AdminAccount) => {
    setEditingAdminId(admin.id);
    setEditAdminName(admin.name);
    setEditAdminEmail(admin.email);
    setEditAdminPassword(admin.password || '');
  };

  const saveEdit = (id: string) => {
    if (!editName.trim() || !editPhone.trim()) return;

    onUpdateStaff(id, {
      name: editName.trim(),
      phone: editPhone.trim(),
      role: editRole,
      commissionRate: editCommissionRate / 100,
      baseSalary: Number(editBaseSalary),
      hourlyRate: editRole === 'Support' ? Number(editHourlyRate) : undefined,
      status: editStatus,
      username: editUsername.trim() || editPhone.trim(),
      password: editPassword.trim() || '1234'
    });

    setEditingId(null);
  };

  const saveEditAdmin = (id: string) => {
    if (!editAdminName.trim() || !editAdminEmail.trim() || !editAdminPassword.trim()) return;

    if (onUpdateAdmin) {
      onUpdateAdmin(id, {
        name: editAdminName.trim(),
        email: editAdminEmail.trim(),
        password: editAdminPassword.trim()
      });
    }

    setEditingAdminId(null);
  };

  const filteredStaff = staffList.filter(stf =>
    stf.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    stf.phone.includes(searchTerm) || 
    stf.role.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredAdmins = adminAccounts.filter(adm =>
    adm.name.toLowerCase().includes(adminSearchTerm.toLowerCase()) ||
    adm.email.toLowerCase().includes(adminSearchTerm.toLowerCase())
  );

  return (
    <div id="staff-management-section" className="space-y-6">
      {/* Search and action header */}
      <div className="flex flex-col md:flex-row justify-between items-stretch md:items-center gap-4 bg-white p-5 rounded-lg border border-border shadow-sm">
        <div>
          <h3 className="font-serif text-lg font-bold text-foreground">Quản lý nhân sự & tài khoản</h3>
          <p className="text-sm text-muted-foreground">Thiết lập nhân viên, tỷ lệ chia hoa hồng của thợ nail và phân quyền tài khoản quản lý</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Section Tab Selector */}
          <div className="flex bg-background p-1 rounded-md border border-border">
            <button
              type="button"
              onClick={() => setSubTab('technicians')}
              className={`px-4 py-1.5 rounded-lg text-sm font-semibold cursor-pointer transition-all ${
                subTab === 'technicians'
                  ? 'bg-accent text-accent-foreground text-white shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              💅 Hồ sơ Kỹ thuật viên
            </button>
            <button
              type="button"
              onClick={() => setSubTab('admins')}
              className={`px-4 py-1.5 rounded-lg text-sm font-semibold cursor-pointer transition-all ${
                subTab === 'admins'
                  ? 'bg-accent text-accent-foreground text-white shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              👑 Tài khoản Admin
            </button>
          </div>

          {subTab === 'technicians' ? (
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="w-4 h-4 text-muted-foreground absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Tìm kiếm KTV..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="bg-background border border-border rounded-md pl-10 pr-4 py-2 text-sm focus:outline-hidden focus:ring-1 focus:ring-[var(--accent)] focus:bg-white transition-all text-foreground w-44 md:w-56"
                />
              </div>
              <button
                onClick={() => setShowAddForm(!showAddForm)}
                className="p-2 px-4 bg-accent text-accent-foreground hover:bg-accent text-accent-foreground text-white rounded-md text-sm font-semibold flex items-center gap-1.5 transition-all cursor-pointer shadow-sm whitespace-nowrap"
              >
                <UserPlus className="w-4 h-4" /> Thêm thợ mới
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="w-4 h-4 text-muted-foreground absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Tìm kiếm Admin..."
                  value={adminSearchTerm}
                  onChange={(e) => setAdminSearchTerm(e.target.value)}
                  className="bg-background border border-border rounded-md pl-10 pr-4 py-2 text-sm focus:outline-hidden focus:ring-1 focus:ring-[var(--accent)] focus:bg-white transition-all text-foreground w-44 md:w-56"
                />
              </div>
              <button
                onClick={() => setShowAddAdminForm(!showAddAdminForm)}
                className="p-2 px-4 bg-muted hover:bg-accent text-white rounded-md text-sm font-semibold flex items-center gap-1.5 transition-all cursor-pointer shadow-sm whitespace-nowrap"
              >
                <Shield className="w-4 h-4 text-accent" /> Thêm Admin mới
              </button>
            </div>
          )}
        </div>
      </div>

      {subTab === 'technicians' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Creator Panel for Technicians */}
          {showAddForm && (
            <form onSubmit={handleCreate} className="lg:col-span-4 bg-white p-6 rounded-lg border border-border shadow-sm space-y-4">
              <div>
                <h4 className="font-serif text-base font-bold text-foreground">Thêm kỹ thuật viên mới</h4>
                <p className="text-[11px] text-muted-foreground">Tạo mới hồ sơ nhân sự để ghi nhận lịch đặt móng & hoa hồng</p>
              </div>

              <div className="space-y-3.5 text-sm">
                <div>
                  <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wilder mb-1">Họ tên nhân viên</label>
                  <input
                    type="text"
                    placeholder="Ví dụ: Nguyễn Trâm Anh..."
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-foreground focus:ring-1 focus:ring-[var(--accent)]"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wilder mb-1">Số điện thoại liên hệ</label>
                  <input
                    type="tel"
                    placeholder="Ví dụ: 0912xxxxxx..."
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-foreground focus:ring-1 focus:ring-[var(--accent)]"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wilder mb-1">Chức danh / Vị trí</label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-foreground focus:ring-1 focus:ring-[var(--accent)]"
                  >
                    {roleOptions.map(opt => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>

                {role === 'Support' ? (
                  <div>
                    <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wilder mb-1">Lương theo giờ (VNĐ/giờ)</label>
                    <input
                      type="number"
                      min="0"
                      required
                      value={hourlyRate}
                      onChange={(e) => setHourlyRate(Number(e.target.value))}
                      className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-foreground font-mono focus:ring-1 focus:ring-[var(--accent)]"
                    />
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wilder mb-1">Hoa hồng (%)</label>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        required
                        value={commissionRate}
                        onChange={(e) => setCommissionRate(Number(e.target.value))}
                        className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-foreground font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wilder mb-1">Lương nhật cứng (đ)</label>
                      <input
                        type="number"
                        min="0"
                        required
                        value={baseSalary}
                        onChange={(e) => setBaseSalary(Number(e.target.value))}
                        className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-foreground font-mono"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wilder mb-1">Trạng thái làm việc</label>
                  <div className="flex gap-4 mt-1">
                    <label className="flex items-center gap-1.5 cursor-pointer text-foreground">
                      <input
                        type="radio"
                        checked={status === 'active'}
                        onChange={() => setStatus('active')}
                        className="text-accent focus:ring-[var(--accent)]"
                      />
                      Đang làm việc
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer text-foreground">
                      <input
                        type="radio"
                        checked={status === 'inactive'}
                        onChange={() => setStatus('inactive')}
                        className="text-accent focus:ring-[var(--accent)]"
                      />
                      Nghỉ phép/Nghỉ hẳn
                    </label>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 border-t border-border pt-3">
                  <div>
                    <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wilder mb-1">Tên đăng nhập thợ</label>
                    <input
                      type="text"
                      placeholder="Ví dụ: tram_anh"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-foreground"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wilder mb-1">Mật khẩu</label>
                    <input
                      type="text"
                      placeholder="Ví dụ: 1234"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full bg-background border border-border rounded-lg px-3 py-1.5 text-foreground"
                    />
                  </div>
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    type="submit"
                    className="flex-1 py-2.5 bg-accent text-accent-foreground hover:bg-accent text-accent-foreground text-white rounded-lg font-semibold cursor-pointer text-sm min-h-[44px] touch-manipulation"
                  >
                    Lưu Nhân Sự
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAddForm(false)}
                    className="px-3 py-2.5 bg-muted hover:bg-muted text-foreground rounded-lg font-semibold cursor-pointer text-sm"
                  >
                    Hủy
                  </button>
                </div>
              </div>
            </form>
          )}

          {/* Technicians List Grid */}
          <div className={`${showAddForm ? 'lg:col-span-8' : 'lg:col-span-12'} bg-white rounded-lg border border-border shadow-sm overflow-hidden`}>
            <div className="p-5 border-b border-border flex justify-between items-center bg-white">
              <h4 className="font-serif text-base font-bold text-foreground flex items-center gap-2">
                <Briefcase className="w-4 h-4 text-accent" /> Danh sách hồ sơ KTV ({filteredStaff.length})
              </h4>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-background text-[10px] font-bold text-muted-foreground uppercase tracking-wider border-b border-border">
                  <tr>
                    <th className="px-5 py-3.5">Họ và Tên / Điện thoại</th>
                    <th className="px-5 py-3.5">Phân vai / Vị trí</th>
                    <th className="px-5 py-3.5 text-center w-28">Hoa hồng</th>
                    <th className="px-5 py-3.5 text-right w-36">Lương nhật</th>
                    <th className="px-5 py-3.5 text-center w-32">Trạng thái</th>
                    <th className="px-5 py-3.5 text-center w-28">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#fdf8f6]">
                  {filteredStaff.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-5 py-12 text-center text-sm text-muted-foreground italic">
                        Không tìm thấy nhân viên nào phù hợp với bộ lọc tìm kiếm.
                      </td>
                    </tr>
                  ) : (
                    filteredStaff.map(stf => {
                      const isEditing = editingId === stf.id;
                      return (
                        <tr key={stf.id} className="hover:bg-muted/15 transition-all text-sm">
                          <td className="px-5 py-3.5">
                            {isEditing ? (
                              <div className="space-y-1.5 max-w-[200px]">
                                <input
                                  type="text"
                                  value={editName}
                                  onChange={(e) => setEditName(e.target.value)}
                                  className="w-full bg-white border border-border rounded p-1 px-2 text-sm font-semibold text-foreground focus:ring-1 focus:ring-[var(--accent)]"
                                  placeholder="Họ tên"
                                />
                                <input
                                  type="text"
                                  value={editPhone}
                                  onChange={(e) => setEditPhone(e.target.value)}
                                  className="w-full bg-white border border-border rounded p-1 px-2 text-sm font-mono focus:ring-1 focus:ring-[var(--accent)]"
                                  placeholder="Số điện thoại"
                                />
                                <div className="grid grid-cols-2 gap-1 pt-1 border-t border-dashed border-border">
                                  <input
                                    type="text"
                                    value={editUsername}
                                    onChange={(e) => setEditUsername(e.target.value)}
                                    className="w-full bg-white border border-border rounded p-0.5 px-1 text-[10px] text-foreground"
                                    placeholder="User login"
                                  />
                                  <input
                                    type="password"
                                    value={editPassword}
                                    onChange={(e) => setEditPassword(e.target.value)}
                                    className="w-full bg-white border border-border rounded p-0.5 px-1 text-[10px] text-foreground"
                                    placeholder="Mật khẩu"
                                  />
                                </div>
                              </div>
                            ) : (
                              <div>
                                <p className="font-semibold text-foreground">{stf.name}</p>
                                <p className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
                                  <Phone className="w-3 h-3 text-foreground" /> {stf.phone}
                                </p>
                                {(stf.username || stf.password) && (
                                  <p className="text-[9px] mt-1 text-muted-foreground bg-muted border border-border px-1.5 py-0.5 rounded-md inline-flex items-center gap-1 font-sans font-semibold">
                                    <Lock className="w-3 h-3" /> Tài khoản đã thiết lập
                                  </p>
                                )}
                              </div>
                            )}
                          </td>

                          <td className="px-5 py-3.5">
                            {isEditing ? (
                              <select
                                value={editRole}
                                onChange={(e) => setEditRole(e.target.value)}
                                className="bg-white border border-border p-1 rounded text-sm text-foreground"
                              >
                                {roleOptions.map(opt => (
                                  <option key={opt} value={opt}>{opt}</option>
                                ))}
                              </select>
                            ) : (
                              <span className="text-foreground font-medium">{stf.role}</span>
                            )}
                          </td>

                          <td className="px-5 py-3.5 text-center">
                            {isEditing ? (
                              editRole === 'Support' ? (
                                <span className="text-muted-foreground font-medium italic text-[11px]">N/A (Lương giờ)</span>
                              ) : (
                                <div className="inline-flex items-center justify-center gap-1">
                                  <input
                                    type="number"
                                    min="0"
                                    max="100"
                                    value={editCommissionRate}
                                    onChange={(e) => setEditCommissionRate(Number(e.target.value))}
                                    className="w-12 bg-white border border-border text-center rounded p-1 text-sm font-mono"
                                  />
                                  <span className="text-muted-foreground">%</span>
                                </div>
                              )
                            ) : (
                              stf.role === 'Support' ? (
                                <span className="px-2 py-0.5 bg-muted text-muted-foreground rounded font-bold text-[9px] uppercase tracking-wider">
                                  Theo giờ
                                </span>
                              ) : (
                                <span className="px-2.5 py-1 bg-muted text-accent rounded-md font-mono font-semibold text-[10px] border border-muted">
                                  {Math.round(stf.commissionRate * 100)}%
                                </span>
                              )
                            )}
                          </td>

                          <td className="px-5 py-3.5 text-right font-mono">
                            {isEditing ? (
                              editRole === 'Support' ? (
                                <div className="inline-flex items-center gap-1">
                                  <input
                                    type="number"
                                    min="0"
                                    value={editHourlyRate}
                                    onChange={(e) => setEditHourlyRate(Number(e.target.value))}
                                    className="w-20 bg-white border border-border text-right rounded p-1 text-sm font-mono"
                                  />
                                  <span className="text-[10px] text-muted-foreground">đ/g</span>
                                </div>
                              ) : (
                                <div className="inline-flex items-center gap-1">
                                  <input
                                    type="number"
                                    min="0"
                                    value={editBaseSalary}
                                    onChange={(e) => setEditBaseSalary(Number(e.target.value))}
                                    className="w-20 bg-white border border-border text-right rounded p-1 text-sm font-mono"
                                  />
                                  <span className="text-[10px] text-muted-foreground">đ</span>
                                </div>
                              )
                            ) : (
                              stf.role === 'Support' ? (
                                <span className="font-semibold text-accent">{(stf.hourlyRate || 30000).toLocaleString()}đ/giờ</span>
                              ) : (
                                <span className="font-semibold text-foreground">{(stf.baseSalary || 0).toLocaleString()}đ</span>
                              )
                            )}
                          </td>

                          <td className="px-5 py-3.5 text-center">
                            {isEditing ? (
                              <select
                                value={editStatus}
                                onChange={(e) => setEditStatus(e.target.value as 'active' | 'inactive')}
                                className="bg-white border border-border p-1 rounded text-[11px]"
                              >
                                <option value="active">Đang làm việc</option>
                                <option value="inactive">Nghỉ phép</option>
                              </select>
                            ) : (
                              <span className={`inline-block px-2.5 py-1 rounded-full text-[9px] font-semibold border ${
                                stf.status === 'active'
                                  ? 'bg-emerald-50 border-emerald-100 text-emerald-700'
                                  : 'bg-card hover:bg-muted border-border text-muted-foreground'
                              }`}>
                                {stf.status === 'active' ? 'Đang làm việc' : 'Nghỉ phép'}
                              </span>
                            )}
                          </td>

                          <td className="px-5 py-3.5 text-center">
                            {isEditing ? (
                              <div className="flex items-center justify-center gap-1.5">
                                <button
                                  onClick={() => saveEdit(stf.id)}
                                  title="Lưu thay đổi"
                                  className="p-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg border border-emerald-200 cursor-pointer animate-pulse"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => setEditingId(null)}
                                  title="Bỏ qua"
                                  className="p-1 px-2 bg-muted hover:bg-muted text-muted-foreground rounded text-[10px] font-bold cursor-pointer"
                                >
                                  Hủy
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center justify-center gap-1">
                                <button
                                  onClick={() => startEdit(stf)}
                                  className="p-1.5 bg-background hover:bg-muted text-muted-foreground rounded-lg border border-border cursor-pointer"
                                  title="Sửa thông tin"
                                >
                                  <Edit2 className="w-3 h-3 text-muted-foreground" />
                                </button>
                                <button
                                  onClick={() => {
                                    if (confirm(`Bạn có chắc chắn muốn xóa hồ sơ của nhân sự "${stf.name}" không?`)) {
                                      onDeleteStaff(stf.id);
                                    }
                                  }}
                                  className="p-1.5 bg-muted hover:bg-muted text-red-650 rounded-lg border border-muted cursor-pointer"
                                  title="Xóa nhân sự"
                                >
                                  <Trash2 className="w-3 h-3 text-red-650" />
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Creator Panel for Administrators */}
          {showAddAdminForm && (
            <form onSubmit={handleCreateAdmin} className="lg:col-span-4 bg-white p-6 rounded-lg border border-border shadow-sm space-y-4">
              <div>
                <h4 className="font-serif text-base font-bold text-foreground flex items-center gap-1.5">
                  <Shield className="w-4 h-4 text-foreground" /> Thêm tài khoản Admin
                </h4>
                <p className="text-[11px] text-muted-foreground">Cấp quyền quản trị viên tối cao để quản lý doanh thu, xem báo cáo & thiết lập toàn hệ thống</p>
              </div>

              <div className="space-y-3.5 text-sm">
                <div>
                  <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wilder mb-1">Họ tên quản trị viên</label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <input
                      type="text"
                      placeholder="Ví dụ: Nguyễn Hoàng Anh..."
                      required
                      value={adminName}
                      onChange={(e) => setAdminName(e.target.value)}
                      className="w-full bg-background border border-border rounded-lg pl-9 pr-3 py-2 text-foreground focus:ring-1 focus:ring-[var(--accent)]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wilder mb-1">Email / Tài khoản đăng nhập</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <input
                      type="email"
                      placeholder="Ví dụ: hoanganh23091997@gmail.com"
                      required
                      value={adminEmail}
                      onChange={(e) => setAdminEmail(e.target.value)}
                      className="w-full bg-background border border-border rounded-lg pl-9 pr-3 py-2 text-foreground focus:ring-1 focus:ring-[var(--accent)]"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wilder mb-1">Mật khẩu đăng nhập</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <input
                      type="password"
                      placeholder="Nhập mật khẩu riêng..."
                      required
                      value={adminPassword}
                      onChange={(e) => setAdminPassword(e.target.value)}
                      className="w-full bg-background border border-border rounded-lg pl-9 pr-3 py-2 text-foreground font-mono focus:ring-1 focus:ring-[var(--accent)]"
                    />
                  </div>
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    type="submit"
                    className="flex-1 py-2.5 bg-muted hover:bg-accent text-white rounded-lg font-semibold cursor-pointer text-sm min-h-[44px] touch-manipulation"
                  >
                    Lưu Admin
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAddAdminForm(false)}
                    className="px-3 py-2.5 bg-muted hover:bg-muted text-foreground rounded-lg font-semibold cursor-pointer text-sm"
                  >
                    Hủy
                  </button>
                </div>
              </div>
            </form>
          )}

          {/* Administrators List Panel */}
          <div className={`${showAddAdminForm ? 'lg:col-span-8' : 'lg:col-span-12'} bg-white rounded-lg border border-border shadow-sm overflow-hidden`}>
            <div className="p-5 border-b border-border flex justify-between items-center bg-white">
              <h4 className="font-serif text-base font-bold text-foreground flex items-center gap-2">
                <Shield className="w-4 h-4 text-accent" /> Danh sách tài khoản quản trị hệ thống ({filteredAdmins.length})
              </h4>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-background text-[10px] font-bold text-muted-foreground uppercase tracking-wider border-b border-border">
                  <tr>
                    <th className="px-5 py-3.5">Họ và Tên Quản Trị</th>
                    <th className="px-5 py-3.5">Email / Tài Khoản đăng nhập</th>
                    <th className="px-5 py-3.5">Xác thực</th>
                    <th className="px-5 py-3.5 text-center w-32">Vai trò</th>
                    <th className="px-5 py-3.5 text-center w-28">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#fdf8f6]">
                  {filteredAdmins.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-5 py-12 text-center text-sm text-muted-foreground italic">
                        Không tìm thấy tài khoản quản trị nào phù hợp.
                      </td>
                    </tr>
                  ) : (
                    filteredAdmins.map(adm => {
                      const isEditingAdmin = editingAdminId === adm.id;
                      return (
                        <tr key={adm.id} className="hover:bg-card hover:bg-muted/50 transition-all text-sm">
                          <td className="px-5 py-3.5 font-semibold text-foreground">
                            {isEditingAdmin ? (
                              <input
                                type="text"
                                value={editAdminName}
                                onChange={(e) => setEditAdminName(e.target.value)}
                                className="w-full bg-white border border-border p-1 px-2 rounded text-sm font-semibold focus:ring-1 focus:ring-[var(--accent)]"
                                required
                              />
                            ) : (
                              <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-accent text-accent-foreground"></span>
                                {adm.name}
                              </div>
                            )}
                          </td>

                          <td className="px-5 py-3.5 text-foreground">
                            {isEditingAdmin ? (
                              <input
                                type="email"
                                value={editAdminEmail}
                                onChange={(e) => setEditAdminEmail(e.target.value)}
                                className="w-full bg-white border border-border p-1 px-2 rounded text-sm focus:ring-1 focus:ring-[var(--accent)]"
                                required
                              />
                            ) : (
                              adm.email
                            )}
                          </td>

                          <td className="px-5 py-3.5 font-mono text-muted-foreground">
                            {isEditingAdmin ? (
                              <input
                                type="password"
                                value={editAdminPassword}
                                onChange={(e) => setEditAdminPassword(e.target.value)}
                                className="w-full bg-white border border-border p-1 px-2 rounded text-sm font-mono focus:ring-1 focus:ring-[var(--accent)]"
                                required
                              />
                            ) : (
                              <span className="bg-muted px-2 py-0.5 rounded border border-border inline-flex items-center gap-1 font-semibold text-[11px] text-muted-foreground">
                                <Lock className="w-3 h-3" /> Đã thiết lập
                              </span>
                            )}
                          </td>

                          <td className="px-5 py-3.5 text-center">
                            <span className="px-2.5 py-1 bg-muted text-accent rounded-full text-[9px] font-sans font-bold border border-muted flex items-center justify-center gap-0.5 max-w-[100px] mx-auto">
                              <Shield className="w-2.5 h-2.5" /> SYSTEM ADMIN
                            </span>
                          </td>

                          <td className="px-5 py-3.5 text-center">
                            {isEditingAdmin ? (
                              <div className="flex items-center justify-center gap-1.5">
                                <button
                                  onClick={() => saveEditAdmin(adm.id)}
                                  title="Lưu Admin"
                                  className="p-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg border border-emerald-200 cursor-pointer"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => setEditingAdminId(null)}
                                  className="p-1 px-2 bg-muted hover:bg-muted text-muted-foreground rounded text-[10px] font-bold cursor-pointer"
                                >
                                  Hủy
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center justify-center gap-1">
                                <button
                                  onClick={() => startEditAdmin(adm)}
                                  className="p-1.5 bg-background hover:bg-muted text-muted-foreground rounded-lg border border-border cursor-pointer"
                                  title="Sửa Admin"
                                >
                                  <Edit2 className="w-3 h-3 text-muted-foreground" />
                                </button>
                                <button
                                  onClick={() => {
                                    if (adminAccounts.length <= 1) {
                                      alert("Không thể xóa tài khoản Admin duy nhất! Vui lòng tạo tài khoản Admin thay thế trước.");
                                      return;
                                    }
                                    if (confirm(`Bạn có chắc chắn muốn xóa tài khoản quản trị viên "${adm.name}" không?`)) {
                                      if (onDeleteAdmin) onDeleteAdmin(adm.id);
                                    }
                                  }}
                                  className="p-1.5 bg-muted hover:bg-muted text-red-650 rounded-lg border border-muted cursor-pointer"
                                  title="Xóa Admin"
                                >
                                  <Trash2 className="w-3 h-3 text-red-650" />
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
