import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDeployments } from './api';

export default function Services() {
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchServices = async () => {
      try {
        const data = await getDeployments();
        const active = data.filter(d => d.status === 'running' || d.status === 'completed');
        setServices(active);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchServices();
  }, []);

  const grouped = {
    web: services.filter(s => s.service_type === 'web'),
    apk: services.filter(s => s.service_type === 'apk'),
  };

  if (loading) {
    return <div className="p-8 text-zinc-400">Loading services...</div>;
  }

  const totalActive = services.length;
  const webCount = grouped.web.length;
  const apkCount = grouped.apk.length;

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-semibold tracking-tight">Services</h1>
        <p className="text-zinc-400 mt-1">Live view of your running infrastructure</p>
      </div>

      {/* Quick stats - unique to Services page */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 text-center">
          <div className="text-2xl font-semibold">{totalActive}</div>
          <div className="text-sm text-zinc-400">Total Active</div>
        </div>
        <div className="bg-zinc-900 border border-emerald-800 rounded-2xl p-4 text-center">
          <div className="text-2xl font-semibold text-emerald-400">{webCount}</div>
          <div className="text-sm text-emerald-400">Web Services</div>
        </div>
        <div className="bg-zinc-900 border border-violet-800 rounded-2xl p-4 text-center">
          <div className="text-2xl font-semibold text-violet-400">{apkCount}</div>
          <div className="text-sm text-violet-400">APK Builds</div>
        </div>
      </div>

      <div className="space-y-10">
        <ServiceSection
          icon="🌐"
          title="Web Services"
          items={grouped.web}
          emptyText="No active web services."
          navigate={navigate}
          renderItem={(s) => (
            <>
              <div className="font-medium">{s.project_name}</div>
              <div className="text-sm text-zinc-400 truncate">
                {(() => {
                  const name = (s.project_name || 'project').toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
                  return `https://${name}.hgu.app`;
                })()}
              </div>
            </>
          )}
        />

        <ServiceSection
          icon="📱"
          title="APK Builds"
          items={grouped.apk}
          emptyText="No recent APK builds."
          navigate={navigate}
          renderItem={(s) => (
            <>
              <div className="font-medium">{s.project_name}</div>
              <div className="text-sm text-zinc-400">APK ready for download</div>
            </>
          )}
        />
      </div>
    </div>
  );
}

function ServiceSection({ icon, title, items, emptyText, navigate, renderItem }) {
  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <span className="text-2xl">{icon}</span>
        <h2 className="text-xl font-semibold">{title}</h2>
        <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${
          items.length > 0
            ? 'bg-emerald-500/10 text-emerald-400'
            : 'bg-zinc-800 text-zinc-400'
        }`}>
          {items.length} active
        </span>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
        {items.length === 0 ? (
          <div className="px-5 py-6 text-sm text-zinc-400">{emptyText}</div>
        ) : (
          <div className="divide-y divide-zinc-800">
            {items.map((service) => (
              <div
                key={service.id}
                onClick={() => {
                  localStorage.setItem('currentProject', service.project_name);
                  navigate('/detail');
                }}
                className="px-5 py-4 flex items-center gap-4 hover:bg-zinc-800 cursor-pointer transition group"
              >
                {/* Left content: name + description */}
                <div className="flex-1 min-w-0">
                  {renderItem(service)}
                </div>

                {/* Status badge - always same position */}
                <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium shrink-0 ${
                  service.status === 'running' || service.status === 'completed'
                    ? 'bg-emerald-500/10 text-emerald-400'
                    : 'bg-amber-500/10 text-amber-400'
                }`}>
                  {service.status}
                </span>

                {/* Details button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    localStorage.setItem('currentProject', service.project_name);
                    navigate('/detail');
                  }}
                  className="text-sm px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition opacity-0 group-hover:opacity-100 shrink-0"
                >
                  Details
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
