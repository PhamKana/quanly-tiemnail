import React, { useState, useEffect } from 'react';
import { Customer, Appointment } from '@shared/types';
import { UserPlus, Search, Phone, History, ShieldAlert, Edit, Trash2, Save, X, Wallet, Plus, Minus } from 'lucide-react';

import { findCustomersByExactName } from '@/shared/utils/customerIdentity';

interface CustomerDirectoryProps {
  customers: Customer[];
  appointments: Appointment[];
  onAddCustomer: (customer: Omit<Customer, 'id' | 'totalVisits' | 'totalSpent' | 'createdAt'>) => void;
  onUpdateCustomer?: (id: string, updatedFields: Partial<Omit<Customer, 'id' | 'totalVisits' | 'totalSpent' | 'createdAt'>>) => void;
  onDeleteCustomer?: (id: string) => void;
}

export default function CustomerDirectory({ 
  customers, 
  appointments, 
  onAddCustomer,
  onUpdateCustomer,
  onDeleteCustomer
}: CustomerDirectoryProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [visibleCount, setVisibleCount] = useState(15);
  const [showAddForm, setShowAddForm] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [showDuplicateNameWarning, setShowDuplicateNameWarning] = useState(false);
  const matchingCustomersByName = findCustomersByExactName(customers, name);

  // Reset progressive load limit on search query change to keep DOM tiny
  useEffect(() => {
    setVisibleCount(15);
  }, [searchTerm]);

  const [activeCustomerId, setActiveCustomerId] = useState<string | null>(customers[0]?.id || null);

  // Edit states
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Wallet adjustment states
  const [walletAmount, setWalletAmount] = useState('');
  const [walletNote, setWalletNote] = useState('');
  const [showWalletControls, setShowWalletControls] = useState(false);

  const activeCustomer = customers.find(c => c.id === activeCustomerId);

  // Filter and sort customers
  const { filteredCustomers, sortedCustomers } = React.useMemo(() => {
    const filtered = customers.filter(c =>
      (c.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (c.phone || '').includes(searchTerm) ||
      (c.email || '').toLowerCase().includes(searchTerm.toLowerCase())
    );

    const sorted = [...filtered].sort((a, b) => {
      const aHasDeposit = (a.walletBalance || 0) > 0;
      const bHasDeposit = (b.walletBalance || 0) > 0;

      if (aHasDeposit && !bHasDeposit) return -1; // a lên trước
      if (!aHasDeposit && bHasDeposit) return 1;  // b lên trước
      if (aHasDeposit && bHasDeposit) {
        return (b.walletBalance || 0) - (a.walletBalance || 0); // nhiều cọc hơn lên đầu
      }
      return 0; // giữ nguyên thứ tự các khách không có cọc
    });

    return { filteredCustomers: filtered, sortedCustomers: sorted };
  }, [customers, searchTerm]);

  const displayedCustomers = sortedCustomers.slice(0, visibleCount);

  // Sync editing fields when switching customers
  useEffect(() => {
    if (activeCustomer) {
      setEditName(activeCustomer.name || '');
      setEditPhone(activeCustomer.phone || '');
      setEditEmail(activeCustomer.email || '');
      setEditNotes(activeCustomer.notes || '');
    } else {
      setEditName('');
      setEditPhone('');
      setEditEmail('');
      setEditNotes('');
    }
    setIsEditing(false);
    setShowDeleteConfirm(false);
    setWalletAmount('');
    setWalletNote('');
  }, [activeCustomerId]);

  // Keep activeCustomerId synchronized with sortedCustomers search results
  useEffect(() => {
    if (sortedCustomers.length > 0) {
      if (!activeCustomerId || !sortedCustomers.some(c => c.id === activeCustomerId)) {
        setActiveCustomerId(sortedCustomers[0].id);
      }
    } else {
      setActiveCustomerId(null);
    }
  }, [sortedCustomers, activeCustomerId]);

  const createCustomer = () => {
    onAddCustomer({
      name: name.trim(),
      phone: phone.trim(),
      email: email.trim(),
      notes: notes.trim()
    });

    setName('');
    setPhone('');
    setEmail('');
    setNotes('');
    setShowAddForm(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    if (matchingCustomersByName.length > 0) {
      setShowDuplicateNameWarning(true);
      return;
    }

    createCustomer();
  };

  const handleUpdateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editName.trim() || !activeCustomer) return;

    if (onUpdateCustomer) {
      onUpdateCustomer(activeCustomer.id, {
        name: editName.trim(),
        phone: editPhone.trim(),
        email: editEmail.trim(),
        notes: editNotes,
      });
    }
    setIsEditing(false);
  };

  const formatCurrency = (val: number) => `${val.toLocaleString('vi-VN')}đ`;

  // Get history of appointments for selected customer
  const customerAppointments = activeCustomerId
    ? appointments.filter(a => a.customerId === activeCustomerId)
    : [];

  return (
    <div id="customer-directory-section" className="grid grid-cols-1 lg:grid-cols-12 gap-8 animate-fade-in">
      {/* Customer List Column */}
      <div className="lg:col-span-5 bg-white p-6 rounded-lg border border-border shadow-sm space-y-5">
        <div className="flex justify-between items-center">
          <div>
            <h3 className="font-serif text-2xl font-normal text-foreground">Danh bạ khách hàng</h3>
            <p className="text-sm text-muted-foreground">Tra cứu thông tin, sở thích móng và lịch sử làm đẹp</p>
          </div>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="p-1 px-3 bg-accent text-accent-foreground hover:bg-accent text-white rounded-full font-medium text-sm flex items-center gap-1.5 transition-all text-pointer cursor-pointer"
          >
            <UserPlus className="w-3.5 h-3.5" /> Thêm khách
          </button>
        </div>

        {/* Total Wallet Balance of all customers Card */}
        <div className="bg-amber-50/50 p-4 rounded-md border border-amber-100 hover:bg-amber-50 transition-all flex items-center justify-between">
          <div className="space-y-1">
            <span className="block text-[10px] uppercase font-bold tracking-wider text-amber-800 flex items-center gap-1">
              👛 Tổng tiền cọc (Ví khách hàng)
            </span>
            <div className="flex items-baseline gap-1">
              <span className="font-serif text-2xl font-bold text-amber-950">{(customers.reduce((sum, c) => sum + (c.walletBalance || 0), 0)).toLocaleString('vi-VN')}đ</span>
            </div>
          </div>
          <div className="p-2.5 bg-amber-500 text-white rounded-md">
            <Wallet className="w-5 h-5" />
          </div>
        </div>

        {/* Add Customer Form */}
        {showAddForm && (
          <form onSubmit={handleSubmit} className="bg-card hover:bg-muted p-4 rounded-md border border-border space-y-3">
            <h4 className="text-sm font-semibold text-foreground uppercase tracking-wider">Thông tin khách mới</h4>
            <div className="space-y-2">
              <input
                type="text"
                placeholder="Họ và tên..."
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-white border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-hidden focus:ring-1 focus:ring-accent"
              />
              <input
                type="tel"
                placeholder="Số điện thoại (không bắt buộc)..."
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full bg-white border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-hidden focus:ring-1 focus:ring-accent"
              />
              <input
                type="email"
                placeholder="Địa chỉ Email (nếu có)..."
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-white border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-hidden focus:ring-1 focus:ring-accent"
              />
              <textarea
                placeholder="Lưu ý đặc biệt (sở thích vẽ móng, móng mỏng, màu sắc yêu thích)..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="w-full bg-white border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-hidden focus:ring-1 focus:ring-accent"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                className="flex-1 bg-accent text-accent-foreground hover:bg-accent text-white py-2 rounded-lg text-sm font-semibold cursor-pointer min-h-[44px] touch-manipulation"
              >
                Tạo khách hàng
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowDuplicateNameWarning(false);
                  setShowAddForm(false);
                }}
                className="px-3 py-2 bg-muted hover:bg-muted text-foreground rounded-lg text-sm cursor-pointer"
              >
                Hủy
              </button>
            </div>
          </form>
        )}

        {/* Search Bar */}
        <div className="relative">
          <Search className="w-4 h-4 text-muted-foreground absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Tìm kiếm theo tên hoặc SĐT..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-card hover:bg-muted border border-border rounded-md pl-10 pr-4 py-2.5 text-sm text-foreground focus:outline-hidden focus:ring-1 focus:ring-accent focus:bg-white transition-all"
          />
        </div>

        {/* Customers list */}
        <div className="space-y-2 max-h-[350px] overflow-y-auto scrollbar-thin pr-1">
          {displayedCustomers.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground italic">
              Không tìm thấy kết quả phù hợp.
            </div>
          ) : (
            <>
              {displayedCustomers.map(cust => {
                const isActive = cust.id === activeCustomerId;
                return (
                  <div
                    key={cust.id}
                    onClick={() => setActiveCustomerId(cust.id)}
                    className={`p-3.5 rounded-md border transition-all cursor-pointer flex justify-between items-center ${
                      isActive
                        ? 'bg-accent/90 border-border text-white'
                        : 'bg-card hover:bg-muted/50 border-border/80 hover:bg-muted'
                    }`}
                  >
                    <div className="space-y-1">
                      <p className={`font-semibold text-sm flex flex-wrap items-center gap-1.5 ${isActive ? 'text-white' : 'text-foreground'}`}>
                        <span>{cust.name}</span>
                      </p>
                      <p className={`text-[10px] font-mono flex items-center gap-1 ${isActive ? 'text-amber-100' : 'text-muted-foreground'}`}>
                        <Phone className="w-2.5 h-2.5" /> {cust.phone || 'Không có SĐT'}
                      </p>
                    </div>
                    <div className="text-right flex flex-col items-end gap-1">
                      <div className="flex items-center gap-1.5 justify-end flex-wrap">
                        {(cust.walletBalance || 0) > 0 && (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-extrabold uppercase tracking-wide border ${
                            isActive 
                              ? 'bg-amber-400 text-amber-950 border-amber-300' 
                              : 'bg-amber-50 text-amber-800 border-amber-200'
                          }`}>
                            Cọc: {formatCurrency(cust.walletBalance || 0)}
                          </span>
                        )}
                        <span className={`p-1 px-2.5 font-semibold text-[9px] font-bold rounded-full ${isActive ? 'bg-white/20 text-white' : 'bg-muted text-foreground'}`}>
                          {cust.totalVisits} lượt
                        </span>
                      </div>
                      <p className={`text-[8px] font-mono ${isActive ? 'text-amber-100' : 'text-muted-foreground'}`}>
                        Đã góp: {(cust.totalSpent ?? 0).toLocaleString()}đ
                      </p>
                    </div>
                  </div>
                );
              })}
              
              {filteredCustomers.length > visibleCount && (
                <button
                  type="button"
                  onClick={() => setVisibleCount(p => p + 15)}
                  className="w-full mt-2 py-2 text-center border border-dashed border-border rounded-md text-[10px] font-mono font-medium text-accent hover:bg-muted font-bold transition-all cursor-pointer uppercase tracking-wider"
                >
                  Xem thêm (+15 khách hàng)
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Customer Detail Column */}
      <div className="lg:col-span-7 bg-white p-6 rounded-lg border border-border shadow-sm">
        {activeCustomer ? (
          isEditing ? (
            /* Editing mode form */
            <form onSubmit={handleUpdateSubmit} className="space-y-5">
              <div className="flex justify-between items-center border-b border-border pb-4">
                <div>
                  <h3 className="font-serif text-lg font-bold text-foreground">Sửa thông tin khách hàng</h3>
                  <p className="text-sm text-muted-foreground">Mã khách: <span className="font-mono">{activeCustomer.id}</span></p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="p-1.5 text-muted-foreground hover:text-muted-foreground rounded-full hover:bg-muted transition-colors pointer-events-auto cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] text-muted-foreground uppercase tracking-wide font-semibold mb-1">Họ và tên *</label>
                  <input
                    type="text"
                    required
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full bg-white border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-hidden focus:ring-1 focus:ring-accent"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] text-muted-foreground uppercase tracking-wide font-semibold mb-1">Số điện thoại (không bắt buộc)</label>
                    <input
                      type="tel"
                      value={editPhone}
                      onChange={(e) => setEditPhone(e.target.value)}
                      className="w-full bg-white border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-hidden focus:ring-1 focus:ring-accent"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-muted-foreground uppercase tracking-wide font-semibold mb-1">Địa chỉ Email</label>
                    <input
                      type="email"
                      value={editEmail}
                      onChange={(e) => setEditEmail(e.target.value)}
                      className="w-full bg-white border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-hidden focus:ring-1 focus:ring-accent"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] text-muted-foreground uppercase tracking-wide font-semibold mb-1">Ghi chú chăm sóc / Màu móng hay vẽ...</label>
                  <textarea
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    rows={3.5}
                    className="w-full bg-white border border-border rounded-md px-3 py-2 text-sm text-foreground focus:outline-hidden focus:ring-1 focus:ring-accent"
                    placeholder="Lưu ý đặc biệt (Ví dụ: móng mỏng thích nhẹ tay, sơn bóng, vẽ hoa hồng...)"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-4 border-t border-border">
                <button
                  type="submit"
                  className="flex-1 bg-accent text-accent-foreground hover:bg-accent text-white py-2.5 rounded-lg text-sm font-semibold cursor-pointer flex items-center justify-center gap-1.5 transition-all min-h-[44px] touch-manipulation"
                >
                  <Save className="w-4 h-4" /> Lưu thay đổi
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="px-4 py-2.5 bg-muted hover:bg-muted text-foreground rounded-lg text-sm font-semibold cursor-pointer transition-all"
                >
                  Hủy bỏ
                </button>
              </div>
            </form>
          ) : (
            /* Standard View Mode */
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4 border-b border-border pb-5">
                <div>
                  <h3 className="font-serif text-3xl font-medium text-foreground">{activeCustomer.name}</h3>
                  <p className="text-sm text-muted-foreground">Khách quen từ ngày: <span className="font-mono">{activeCustomer.createdAt}</span></p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setIsEditing(true);
                      setEditName(activeCustomer.name);
                      setEditPhone(activeCustomer.phone || '');
                      setEditEmail(activeCustomer.email || '');
                      setEditNotes(activeCustomer.notes || '');
                    }}
                    className="p-1 px-3 bg-muted hover:bg-muted text-foreground rounded-lg text-sm font-semibold flex items-center gap-1.5 transition-all cursor-pointer border border-border"
                  >
                    <Edit className="w-3.5 h-3.5" /> Sửa
                  </button>
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    className="p-1 px-3 bg-muted hover:bg-muted text-accent rounded-lg text-sm font-semibold flex items-center gap-1.5 transition-all cursor-pointer border border-muted"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Xóa
                  </button>
                </div>
              </div>

              {/* Delete confirmation inline notification */}
              {showDeleteConfirm && (
                <div className="p-4 bg-muted border border-muted rounded-md space-y-3.5 animate-fade-in">
                  <div className="flex gap-2 text-accent">
                    <ShieldAlert className="w-5 h-5 shrink-0" />
                    <div>
                      <h4 className="small-caps">Xác nhận xóa khách hàng</h4>
                      <p className="text-sm text-accent mt-1 leading-relaxed">
                        Bạn có chắc chắn muốn xóa khách hàng <strong>{activeCustomer.name}</strong> không? Toàn bộ lịch sử làm móng, thống kê lượt ghé thăm và tiền thanh toán sẽ bị xóa vĩnh viễn khỏi hệ thống!
                      </p>
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 text-sm">
                    <button
                      type="button"
                      onClick={() => {
                        if (onDeleteCustomer) {
                          onDeleteCustomer(activeCustomer.id);
                        }
                      }}
                      className="p-2 px-4 bg-accent text-accent-foreground hover:bg-accent text-accent-foreground text-white rounded-lg font-bold cursor-pointer transition-all"
                    >
                      Xóa vĩnh viễn
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowDeleteConfirm(false)}
                      className="p-2 px-4 bg-muted hover:bg-muted text-foreground rounded-lg font-medium cursor-pointer transition-all"
                    >
                      Hủy bỏ
                    </button>
                  </div>
                </div>
              )}

              {/* Info Grid */}
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-card hover:bg-muted rounded-md border border-border">
                  <span className="block text-[10px] text-muted-foreground uppercase tracking-wide font-semibold mb-1">Số điện thoại</span>
                  <p className="font-mono text-sm font-semibold text-foreground">{activeCustomer.phone || 'Không có SĐT'}</p>
                </div>
                <div className="p-4 bg-card hover:bg-muted rounded-md border border-border">
                  <span className="block text-[10px] text-muted-foreground uppercase tracking-wide font-semibold mb-1">Địa chỉ Email</span>
                  <p className="text-sm font-semibold text-foreground break-all">{activeCustomer.email || 'Chưa cung cấp'}</p>
                </div>
              </div>

              {/* Customer Wallet integration */}
              <div className="p-5 bg-muted/50 border border-muted rounded-lg space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="p-2 bg-accent/10 rounded-lg text-accent">
                      <Wallet className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-foreground uppercase tracking-wider">Ví tích trữ & Tiền cọc (Customer Wallet)</h4>
                      <p className="text-[10px] text-muted-foreground">Số dư nạp trước hoặc tiền cọc để khấu giữ đặt lịch</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-[9px] text-muted-foreground uppercase tracking-wider block">Số dư hiện tại</span>
                    <span className="font-mono text-base font-extrabold text-accent">
                      {(activeCustomer.walletBalance ?? 0).toLocaleString()}đ
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setShowWalletControls((open) => !open)}
                  className="w-full flex items-center justify-between rounded-md border border-border bg-white px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted transition-colors cursor-pointer"
                >
                  <span>{showWalletControls ? 'Ẩn điều chỉnh ví' : 'Điều chỉnh ví'}</span>
                  <span className="text-accent">{showWalletControls ? '−' : '+'}</span>
                </button>

                {/* Adjustment Controls */}
                <div className={showWalletControls ? "bg-white p-3.5 rounded-md border border-muted space-y-3 font-sans" : "hidden"}>
                  <span className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Điều chỉnh số dư ví</span>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[9px] text-muted-foreground mb-1">Số tiền (VNĐ)</label>
                      <input
                        type="number"
                        placeholder="Nhập số tiền..."
                        value={walletAmount}
                        onChange={(e) => setWalletAmount(e.target.value)}
                        className="w-full bg-card hover:bg-muted border border-border rounded-lg px-2.5 py-1.5 text-sm text-foreground focus:outline-hidden focus:ring-1 focus:ring-accent font-mono font-semibold"
                      />
                    </div>
                    <div>
                      <label className="block text-[9px] text-muted-foreground mb-1">Ghi chú giao dịch (Không bắt buộc)</label>
                      <input
                        type="text"
                        placeholder="Ví dụ: Cọc giữ chỗ, Khấu trừ..."
                        value={walletNote}
                        onChange={(e) => setWalletNote(e.target.value)}
                        className="w-full bg-card hover:bg-muted border border-border rounded-lg px-2.5 py-1.5 text-sm text-foreground focus:outline-hidden focus:ring-1 focus:ring-accent"
                      />
                    </div>
                  </div>

                  {/* Predefined values */}
                  <div className="flex flex-wrap gap-1 items-center">
                    <span className="text-[9px] text-muted-foreground mr-1">Nhanh:</span>
                    {[50000, 100000, 200000, 500000].map((val) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setWalletAmount(String(val))}
                        className="p-1 px-2.5 bg-muted/60 hover:bg-muted/80 border border-muted/50 rounded-md text-[10px] font-mono font-medium text-accent cursor-pointer active:scale-95 transition-all"
                      >
                        +{val/1000}k
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => { setWalletAmount(''); setWalletNote(''); }}
                      className="p-1 px-2 text-[10px] text-muted-foreground hover:text-foreground font-semibold italic cursor-pointer ml-auto"
                    >
                      Xóa nhập
                    </button>
                  </div>

                  {/* Action buttons */}
                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        const amt = Math.floor(Number(walletAmount));
                        if (Number.isNaN(amt) || amt <= 0 || !activeCustomer) {
                          alert("Vui lòng nhập số tiền hợp lệ và lớn hơn 0");
                          return;
                        }
                        if (onUpdateCustomer) {
                          const oldBalance = Math.max(0, Number(activeCustomer.walletBalance) || 0);
                          const newBalance = oldBalance + amt;

                          const dateText = new Date().toLocaleDateString('vi-VN');
                          const transactionRecord = `\n[${dateText}] Nạp cọc: +${amt.toLocaleString()}đ (${walletNote.trim() || 'Nạp ví'})`;
                          const updatedNotes = (activeCustomer.notes || '') + transactionRecord;

                          onUpdateCustomer(activeCustomer.id, {
                            walletBalance: newBalance,
                            notes: updatedNotes
                          });
                          alert(`Đã nạp thành công ${amt.toLocaleString()}đ vào ví khách hàng.`);
                          setWalletAmount('');
                          setWalletNote('');
                        }
                      }}
                      className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-bold transition-all cursor-pointer flex items-center justify-center gap-1 shadow-sm"
                    >
                      <Plus className="w-3.5 h-3.5" /> Cộng tiền cọc (+)
                    </button>
                    
                    <button
                      type="button"
                      onClick={() => {
                        const requestedAmount = Math.floor(Number(walletAmount));
                        if (Number.isNaN(requestedAmount) || requestedAmount <= 0 || !activeCustomer) {
                          alert("Vui lòng nhập số tiền hợp lệ và lớn hơn 0");
                          return;
                        }
                        if (onUpdateCustomer) {
                          const oldBalance = Math.max(0, Number(activeCustomer.walletBalance) || 0);
                          const actualDeduction = Math.min(requestedAmount, oldBalance);
                          
                          if (actualDeduction <= 0) {
                            alert("Số dư ví bằng 0, không thể thực hiện trừ tiền!");
                            return;
                          }

                          const newBalance = oldBalance - actualDeduction;

                          const dateText = new Date().toLocaleDateString('vi-VN');
                          const transactionRecord = `\n[${dateText}] Trừ tiền ví: -${actualDeduction.toLocaleString()}đ (${walletNote.trim() || 'Thanh toán'})`;
                          const updatedNotes = (activeCustomer.notes || '') + transactionRecord;

                          onUpdateCustomer(activeCustomer.id, {
                            walletBalance: newBalance,
                            notes: updatedNotes
                          });
                          alert(`Đã trừ thành công ${actualDeduction.toLocaleString()}đ từ ví khách hàng.`);
                          setWalletAmount('');
                          setWalletNote('');
                        }
                      }}
                      className="flex-1 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-sm font-bold transition-all cursor-pointer flex items-center justify-center gap-1 shadow-sm"
                    >
                      <Minus className="w-3.5 h-3.5" /> Trừ tiền ví (-)
                    </button>
                  </div>
                </div>
              </div>

              {/* Special notes */}
              <div className="p-4 bg-muted/40 rounded-md border border-muted">
                <span className="text-[10px] text-accent uppercase tracking-wide font-bold flex items-center gap-1 mb-1.5">
                  <ShieldAlert className="w-3.5 h-3.5" /> Ghi chú chăm sóc / Màu ưa thích
                </span>
                <p className="text-sm text-foreground leading-relaxed italic">
                  {activeCustomer.notes || 'Chưa có lưu ý đặc biệt cho khách hàng này.'}
                </p>
              </div>

              {/* Visit History Timeline */}
              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <History className="w-4 h-4 text-muted-foreground" /> Nhật ký lịch hẹn móng
                </h4>

                {customerAppointments.length === 0 ? (
                  <div className="py-10 text-center text-sm text-muted-foreground italic bg-card hover:bg-muted rounded-md border border-dashed border-border">
                    Khách hàng chưa có lịch hẹn nào lưu trữ trên hệ thống.
                  </div>
                ) : (
                  <div className="space-y-2.5 max-h-[250px] overflow-y-auto scrollbar-thin">
                    {customerAppointments.map((appt) => (
                      <div key={appt.id} className="p-3.5 bg-card hover:bg-muted/50 border border-border rounded-md flex justify-between items-center hover:bg-card hover:bg-muted/100 border-border hover:border-accent transition-all text-sm">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-foreground font-mono">{appt.date}</span>
                            <span className="text-[10px] text-muted-foreground">({appt.time})</span>
                          </div>
                          <p className="text-[11px] text-muted-foreground mt-0.5">Phụ trách: {appt.staffName}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-mono font-bold text-foreground">{(appt.totalPrice ?? 0).toLocaleString()} đ</p>
                          <span className={`inline-block text-[9px] font-bold uppercase tracking-wider mt-1 rounded px-1.5 py-0.5 ${
                            appt.status === 'completed'
                              ? 'bg-emerald-50 text-emerald-700'
                              : appt.status === 'cancelled'
                              ? 'bg-muted text-muted-foreground'
                              : 'bg-muted text-accent'
                          }`}>
                            {appt.status === 'completed' ? 'Hoàn thành' : appt.status === 'cancelled' ? 'Đã hủy' : 'Sắp hẹn'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )
        ) : (
          <div className="flex flex-col items-center justify-center py-24 text-muted-foreground italic text-sm">
            Chọn một khách hàng ở danh sách bên trái để kiểm tra chi tiết.
          </div>
        )}
      </div>
      {showDuplicateNameWarning && (
        <div
          className="fixed inset-0 z-[10002] flex items-center justify-center bg-black/60 p-4 animate-fade-in"
          role="dialog"
          aria-modal="true"
          aria-labelledby="directory-duplicate-name-title"
        >
          <div className="w-full max-w-md rounded-lg border border-amber-200 bg-white p-5 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="shrink-0 rounded-full bg-amber-100 p-2 text-amber-700">
                <ShieldAlert className="h-5 w-5" />
              </div>
              <div className="space-y-2">
                <h3 id="directory-duplicate-name-title" className="font-serif text-lg font-bold text-foreground">
                  Kiểm tra khách trùng tên
                </h3>
                <p className="text-sm leading-relaxed text-foreground">
                  Đã có <strong>{matchingCustomersByName.length}</strong> hồ sơ cùng tên “<strong>{name.trim()}</strong>”.
                </p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Khách mới chưa được tạo và chưa liên kết ví cọc. Hãy quay lại kiểm tra nếu đây có thể là cùng một người.
                </p>
              </div>
            </div>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setShowDuplicateNameWarning(false)}
                className="min-h-[44px] rounded-md border border-border bg-white px-4 py-2.5 text-sm font-bold text-foreground transition-colors hover:bg-muted"
              >
                Quay lại kiểm tra
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowDuplicateNameWarning(false);
                  createCustomer();
                }}
                className="min-h-[44px] rounded-md bg-amber-600 px-4 py-2.5 text-sm font-bold text-white shadow-md transition-colors hover:bg-amber-700"
              >
                Vẫn tạo khách mới
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
