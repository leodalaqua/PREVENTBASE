export default function AppLoading() {
  return (
    <div aria-busy="true" aria-label="Carregando">
      <div className="skeleton mb-4 h-7 w-48" />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="skeleton h-20" />
        ))}
      </div>
      <div className="skeleton h-64" />
    </div>
  );
}
