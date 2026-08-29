import React, { useState } from 'react';
import { NailService } from '@shared/types';
import { Plus, Search, Edit2, Check, Sparkles, Scissors, Clock, DollarSign, Tag, Trash2 } from 'lucide-react';

interface ServiceManagementProps {
  services: NailService[];
  onAddService: (service: Omit<NailService, 'id'>) => void;
  onUpdateService: (id: string, updatedFields: Partial<NailService>) => void;
  onDeleteService: (id: string) => void;
  onResetServices?: () => void;
}

export default function ServiceManagement({
  services,
  onAddService,
  onUpdateService,
  onDeleteService,
  onResetServices
}: ServiceManagementProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [showAddForm, setShowAddForm] = useState(false);
  const [visibleCount, setVisibleCount] = useState(20);

  // Add form fields
  const [name, setName] = useState('');
  const [category, setCategory] = useState('basic-nail');

  // Edit fields inline
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editCategory, setEditCategory] = useState('basic-nail');

  const categoriesTranslation: Record<string, string> = {
    'basic-nail': 'Nail Cơ Bản',
    'fake-nail': 'Móng Giả',
    'design': 'Design',
    'accessories': 'Đính Phụ Kiện'
  };

  const categories = ['basic-nail', 'fake-nail', 'design', 'accessories'];

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    onAddService({
      name: name.trim(),
      category: category as any
    });

    setName('');
    setCategory('basic-nail');
    setShowAddForm(false);
  };

  const startEdit = (srv: NailService) => {
    setEditingId(srv.id);
    setEditName(srv.name);
    setEditCategory(srv.category);
  };

  const saveEdit = (id: string) => {
    if (!editName.trim()) return;
    onUpdateService(id, {
      name: editName.trim(),
      category: editCategory as any
    });
    setEditingId(null);
  };

  const filteredServices = services.filter(srv => {
    const matchesSearch = srv.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCat = selectedCategory === 'all' || srv.category === selectedCategory;
    return matchesSearch && matchesCat;
  });

  const visibleServices = filteredServices.slice(0, visibleCount);

  return (
    <div id="service-management-section" className="space-y-6">
      {/* Search, Filter Tabs and Action Row */}
      <div className="flex flex-col md:flex-row justify-between items-stretch md:items-center gap-4 bg-white p-5 rounded-lg border border-border shadow-sm">
        {/* Category filters */}
        <div className="flex flex-wrap gap-1 bg-background p-1 rounded-md">
          <button
            onClick={() => { setSelectedCategory('all'); setVisibleCount(20); }}
            className={`px-3 py-1.5 text-sm font-semibold rounded-lg transition-all cursor-pointer ${
              selectedCategory === 'all'
                ? 'bg-white text-accent shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Tất cả
          </button>
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => { setSelectedCategory(cat); setVisibleCount(20); }}
              className={`px-3 py-1.5 text-sm font-semibold rounded-lg transition-all cursor-pointer ${
                selectedCategory === cat
                  ? 'bg-white text-accent shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {categoriesTranslation[cat] || cat}
            </button>
          ))}
        </div>

        {/* Quick Search and Add Button */}
        <div className="flex items-center gap-2 flex-1 md:max-w-md">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-muted-foreground absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Tìm kiếm dịch vụ..."
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); setVisibleCount(20); }}
              className="w-full bg-background border border-border rounded-md pl-10 pr-4 py-2 text-sm focus:outline-hidden focus:ring-1 focus:ring-[var(--accent)] focus:bg-white transition-all text-foreground"
            />
          </div>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="p-2 px-4 bg-accent text-accent-foreground hover:bg-accent text-accent-foreground text-white rounded-md text-sm font-semibold flex items-center gap-1.5 transition-all cursor-pointer shadow-sm whitespace-nowrap"
          >
            <Plus className="w-4 h-4" /> Thêm dịch vụ mới
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Creator / Editor Column if toggled */}
        {showAddForm && (
          <div className="lg:col-span-4 bg-white p-6 rounded-lg border border-border shadow-sm space-y-4">
            <div>
              <h3 className="font-serif text-lg font-bold text-foreground">Tạo dịch vụ mới</h3>
              <p className="text-sm text-muted-foreground">Thiết lập thông tin dịch vụ nail mới</p>
            </div>

            <form onSubmit={handleCreate} className="space-y-4 text-sm">
              <div>
                <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Tên dịch vụ</label>
                <input
                  type="text"
                  placeholder="Ví dụ: Sơn Gel đính đá xịn sò..."
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-foreground"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">Phân loại danh mục</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full bg-background border border-border rounded-lg px-3 py-2 text-foreground"
                >
                  {categories.map(cat => (
                    <option key={cat} value={cat}>{categoriesTranslation[cat]}</option>
                  ))}
                </select>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-accent text-accent-foreground hover:bg-accent text-accent-foreground text-white rounded-lg font-semibold cursor-pointer min-h-[44px] touch-manipulation"
                >
                  Thêm dịch vụ
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="px-3 py-2.5 bg-muted hover:bg-muted text-foreground rounded-lg font-semibold cursor-pointer"
                >
                  Hủy
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Catalog Table and Details */}
        <div className={`${showAddForm ? 'lg:col-span-8' : 'lg:col-span-12'} bg-white rounded-lg border border-border shadow-sm overflow-hidden`}>
          <div className="p-5 border-b border-border flex flex-col sm:flex-row justify-between sm:items-center bg-white gap-3">
            <div>
              <h3 className="font-serif text-lg font-bold text-foreground flex items-center gap-1.5">
                <Scissors className="w-4 h-4 text-accent" /> Danh mục dịch vụ ({filteredServices.length})
              </h3>
              <p className="text-sm text-muted-foreground">Xem, tra cứu, chỉnh sửa dịch vụ của tiệm nailby.ank</p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-background text-[10px] font-bold text-muted-foreground uppercase tracking-wider border-b border-border">
                <tr>
                  <th className="px-5 py-3.5">Dịch Vụ & Danh Mục</th>
                  <th className="px-5 py-3.5 w-36 text-center">Thao Tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#fdf8f6]">
                {filteredServices.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="px-5 py-12 text-center text-sm text-muted-foreground italic">
                      Không tìm thấy dịch vụ nào phù hợp với bộ lọc danh mục.
                    </td>
                  </tr>
                ) : (
                  visibleServices.map(srv => {
                    const isEditing = editingId === srv.id;
                    return (
                      <tr key={srv.id} className="hover:bg-muted/15 transition-all">
                        <td className="px-5 py-4">
                          {isEditing ? (
                            <div className="space-y-2">
                              <input
                                type="text"
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                className="w-full max-w-xs bg-white border border-border rounded px-2.5 py-1 text-sm text-foreground focus:ring-1 focus:ring-[var(--accent)]"
                              />
                              <select
                                value={editCategory}
                                onChange={(e) => setEditCategory(e.target.value)}
                                className="block max-w-xs bg-white border border-border rounded px-2.5 py-1 text-[10px] text-foreground"
                              >
                                {categories.map(cat => (
                                  <option key={cat} value={cat}>{categoriesTranslation[cat]}</option>
                                ))}
                              </select>
                            </div>
                          ) : (
                            <div>
                              <p className="font-semibold text-sm text-foreground">{srv.name}</p>
                              <span className="inline-block mt-1 px-2 py-0.5 bg-background border border-border text-muted-foreground text-[9px] font-semibold rounded-md">
                                {categoriesTranslation[srv.category] || srv.category}
                              </span>
                            </div>
                          )}
                        </td>

                        <td className="px-5 py-4 text-center">
                          {isEditing ? (
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                onClick={() => saveEdit(srv.id)}
                                title="Lưu thay đổi"
                                className="p-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg transition-all cursor-pointer border border-emerald-200 text-[10px] font-bold"
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => setEditingId(null)}
                                title="Hủy bỏ"
                                className="p-1.5 bg-muted hover:bg-muted text-muted-foreground rounded-lg transition-all cursor-pointer text-[10px] font-bold px-2.5"
                              >
                                Hủy
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-center gap-1">
                              <button
                                onClick={() => startEdit(srv)}
                                className="p-1.5 bg-background hover:bg-muted text-muted-foreground rounded-lg border border-border cursor-pointer transition-all flex items-center justify-center"
                                title="Sửa dịch vụ"
                              >
                                <Edit2 className="w-3 h-3 text-muted-foreground" />
                              </button>
                              <button
                                onClick={() => {
                                  if (confirm(`Bạn chắc chắn muốn xóa dịch vụ "${srv.name}"?`)) {
                                    onDeleteService(srv.id);
                                  }
                                }}
                                className="p-1.5 bg-muted hover:bg-red-105-light text-accent rounded-lg border border-muted cursor-pointer transition-all flex items-center justify-center"
                                title="Xóa dịch vụ"
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
          {filteredServices.length > visibleCount && (
            <div className="border-t border-border p-3 text-center">
              <button
                type="button"
                onClick={() => setVisibleCount((count) => count + 20)}
                className="rounded-md border border-border bg-white px-4 py-2 text-xs font-semibold text-foreground hover:bg-muted transition-colors cursor-pointer"
              >
                Xem thêm ({filteredServices.length - visibleCount} dịch vụ)
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
