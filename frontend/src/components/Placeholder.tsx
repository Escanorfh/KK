export default function Placeholder({ title }: { title: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
      <h2 className="text-lg font-bold text-slate-700">{title}</h2>
      <p className="text-sm text-slate-400 mt-2">هذه الشاشة قيد البناء — قادمة قريبًا</p>
    </div>
  );
}
