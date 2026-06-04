import { useRef, useEffect, useState } from 'react';
import type { SnapshotCluster, CompetitorSnapshot } from '../../../../../shared/api-types';
import { Btn, Card } from '../../../ui';

interface Node {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  label: string;
  type: 'cluster' | 'snapshot';
  snapshot?: CompetitorSnapshot;
  clusterId?: number;
  diffSummary?: string;
  monitorName?: string;
}

interface Link {
  source: string;
  target: string;
}

interface SemanticForceGraphProps {
  clusters: SnapshotCluster[];
  onSynthesize: (ids: number[]) => Promise<void>;
  synthesizing: boolean;
}

export function SemanticForceGraph({ clusters, onSynthesize, synthesizing }: SemanticForceGraphProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [hoveredNode, setHoveredNode] = useState<Node | null>(null);
  
  // Keep physics state in refs so they don't trigger re-renders or get recreated
  const nodesRef = useRef<Node[]>([]);
  const linksRef = useRef<Link[]>([]);
  const draggedNodeIdRef = useRef<string | null>(null);
  const mousePosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  // Mirror hover/selection into refs so the render loop reads them without being
  // torn down and recreated on every mouse move.
  const hoveredRef = useRef<Node | null>(null);
  const selectedRef = useRef<Node | null>(null);
  useEffect(() => { hoveredRef.current = hoveredNode; }, [hoveredNode]);
  useEffect(() => { selectedRef.current = selectedNode; }, [selectedNode]);

  // Initialize graph nodes and links when clusters change
  useEffect(() => {
    const width = 800;
    const height = 500;
    const nodes: Node[] = [];
    const links: Link[] = [];

    // Helper to get platform color
    const getPlatformColor = (linkUrl: string | null) => {
      if (!linkUrl) return '#f26522'; // Default RSS
      if (linkUrl.includes('facebook.com')) return '#1877f2';
      if (linkUrl.includes('youtube.com') || linkUrl.includes('youtu.be')) return '#ff4444';
      if (linkUrl.includes('twitter.com') || linkUrl.includes('x.com')) return '#e5e7eb';
      return '#10b981'; // Website
    };

    clusters.forEach((c) => {
      const clusterNodeId = `cluster_${c.clusterId}`;
      const clusterAngle = (c.clusterId / (clusters.length || 1)) * Math.PI * 2;
      const clusterCenterX = width / 2 + Math.cos(clusterAngle) * 150;
      const clusterCenterY = height / 2 + Math.sin(clusterAngle) * 150;

      // 1. Add cluster center node
      nodes.push({
        id: clusterNodeId,
        x: clusterCenterX + (Math.random() - 0.5) * 20,
        y: clusterCenterY + (Math.random() - 0.5) * 20,
        vx: 0,
        vy: 0,
        radius: 16,
        color: '#6366f1', // Indigo glow
        label: `مجموعة ${c.clusterId}`,
        type: 'cluster',
        clusterId: c.clusterId,
        diffSummary: c.diffSummary
      });

      // 2. Add main snapshot node
      const mainId = `snap_${c.main.id}`;
      nodes.push({
        id: mainId,
        x: clusterCenterX + (Math.random() - 0.5) * 40,
        y: clusterCenterY + (Math.random() - 0.5) * 40,
        vx: 0,
        vy: 0,
        radius: 11,
        color: getPlatformColor(c.main.link),
        label: c.main.title,
        type: 'snapshot',
        snapshot: c.main
      });

      // Link main snapshot to cluster center
      links.push({ source: clusterNodeId, target: mainId });

      // 3. Add duplicates snapshots nodes
      c.duplicates.forEach((d: CompetitorSnapshot, idx: number) => {
        const dupId = `snap_${d.id}`;
        const offsetAngle = (idx / (c.duplicates.length || 1)) * Math.PI * 2;
        nodes.push({
          id: dupId,
          x: clusterCenterX + Math.cos(offsetAngle) * 50 + (Math.random() - 0.5) * 10,
          y: clusterCenterY + Math.sin(offsetAngle) * 50 + (Math.random() - 0.5) * 10,
          vx: 0,
          vy: 0,
          radius: 7,
          color: getPlatformColor(d.link),
          label: d.title,
          type: 'snapshot',
          snapshot: d
        });

        // Link duplicates to main snapshot
        links.push({ source: mainId, target: dupId });
      });
    });

    nodesRef.current = nodes;
    linksRef.current = links;
    setSelectedNode(null);
    setHoveredNode(null);
  }, [clusters]);

  // Main animation/simulation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;

    const tick = () => {
      const nodes = nodesRef.current;
      const links = linksRef.current;
      const draggedNodeId = draggedNodeIdRef.current;
      const mousePos = mousePosRef.current;

      const width = canvas.width;
      const height = canvas.height;

      // ─── 1. Update physics velocities ───
      
      // Coulomb Repulsion between all nodes
      for (let i = 0; i < nodes.length; i++) {
        const n1 = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const n2 = nodes[j];
          const dx = n2.x - n1.x;
          const dy = n2.y - n1.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const minDist = n1.type === 'cluster' || n2.type === 'cluster' ? 120 : 60;
          if (dist < minDist) {
            const force = 0.5 * (minDist - dist) / dist;
            n1.vx -= dx * force * 0.15;
            n1.vy -= dy * force * 0.15;
            n2.vx += dx * force * 0.15;
            n2.vy += dy * force * 0.15;
          }
        }
      }

      // Hooke's Attraction along links
      for (const link of links) {
        const n1 = nodes.find(n => n.id === link.source);
        const n2 = nodes.find(n => n.id === link.target);
        if (n1 && n2) {
          const dx = n2.x - n1.x;
          const dy = n2.y - n1.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const desiredDist = n1.type === 'cluster' || n2.type === 'cluster' ? 70 : 40;
          const force = (dist - desiredDist) * 0.04;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          n1.vx += fx;
          n1.vy += fy;
          n2.vx -= fx;
          n2.vy -= fy;
        }
      }

      // Center Gravity
      const centerX = width / 2;
      const centerY = height / 2;
      for (const n of nodes) {
        const dx = centerX - n.x;
        const dy = centerY - n.y;
        n.vx += dx * 0.004;
        n.vy += dy * 0.004;
      }

      // ─── 2. Update positions ───
      for (const n of nodes) {
        if (n.id === draggedNodeId) {
          n.x = mousePos.x;
          n.y = mousePos.y;
          n.vx = 0;
          n.vy = 0;
        } else {
          n.x += n.vx;
          n.y += n.vy;
          n.vx *= 0.78; // Friction
          n.vy *= 0.78;
        }

        // Boundary constraints
        n.x = Math.max(n.radius, Math.min(width - n.radius, n.x));
        n.y = Math.max(n.radius, Math.min(height - n.radius, n.y));
      }

      // ─── 3. Render frame ───
      ctx.clearRect(0, 0, width, height);

      // Draw links
      ctx.lineWidth = 1.5;
      for (const link of links) {
        const n1 = nodes.find(n => n.id === link.source);
        const n2 = nodes.find(n => n.id === link.target);
        if (n1 && n2) {
          ctx.beginPath();
          ctx.moveTo(n1.x, n1.y);
          ctx.lineTo(n2.x, n2.y);
          ctx.strokeStyle = n1.type === 'cluster' || n2.type === 'cluster' 
            ? 'rgba(99, 102, 241, 0.25)' 
            : 'rgba(255, 255, 255, 0.08)';
          ctx.stroke();
        }
      }

      // Draw nodes
      for (const n of nodes) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
        ctx.fillStyle = n.color;
        
        // Add glowing shadow for clusters
        if (n.type === 'cluster') {
          ctx.shadowBlur = 15;
          ctx.shadowColor = 'rgba(99, 102, 241, 0.6)';
        } else {
          ctx.shadowBlur = 0;
        }
        ctx.fill();
        ctx.shadowBlur = 0; // reset

        // Draw node border
        ctx.strokeStyle = '#1e1b4b'; // dark bg color
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Draw inner indicator for cluster centers
        if (n.type === 'cluster') {
          ctx.beginPath();
          ctx.arc(n.x, n.y, 6, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.fill();
        }
      }

      // Draw hovered/selected highlights
      const highlightNode = hoveredRef.current || selectedRef.current;
      if (highlightNode) {
        const node = nodes.find(n => n.id === highlightNode.id);
        if (node) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, node.radius + 5, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(99, 102, 241, 0.5)';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }

      // Draw node text for hovered nodes or clusters
      for (const n of nodes) {
        if (n.type === 'cluster' || (hoveredRef.current && hoveredRef.current.id === n.id)) {
          ctx.font = 'bold 11px sans-serif';
          ctx.fillStyle = '#e2e8f0';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          const displayLabel = n.label.length > 24 ? n.label.slice(0, 22) + '..' : n.label;
          
          // Draw subtle background rect behind text for readability
          const textWidth = ctx.measureText(displayLabel).width;
          ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
          ctx.fillRect(n.x - textWidth / 2 - 4, n.y + n.radius + 3, textWidth + 8, 16);
          
          ctx.fillStyle = '#f1f5f9';
          ctx.fillText(displayLabel, n.x, n.y + n.radius + 5);
        }
      }

      animationFrameId = requestAnimationFrame(tick);
    };

    animationFrameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrameId);
  }, []);

  // Handle canvas mouse events
  const getMousePos = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    // Scale coordinates back to canvas dimensions
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const pos = getMousePos(e);
    const clickedNode = nodesRef.current.find(n => {
      const dx = n.x - pos.x;
      const dy = n.y - pos.y;
      return Math.sqrt(dx * dx + dy * dy) <= n.radius + 5;
    });

    if (clickedNode) {
      draggedNodeIdRef.current = clickedNode.id;
      mousePosRef.current = pos;
      setSelectedNode(clickedNode);
    } else {
      setSelectedNode(null);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const pos = getMousePos(e);
    mousePosRef.current = pos;

    if (draggedNodeIdRef.current) {
      // update state of selection to follow drag coordinates dynamically
      setSelectedNode(prev => prev && prev.id === draggedNodeIdRef.current ? { ...prev, x: pos.x, y: pos.y } : prev);
      return;
    }

    // Hover detection
    const hovering = nodesRef.current.find(n => {
      const dx = n.x - pos.x;
      const dy = n.y - pos.y;
      return Math.sqrt(dx * dx + dy * dy) <= n.radius + 5;
    });
    setHoveredNode(hovering || null);
  };

  const handleMouseUp = () => {
    draggedNodeIdRef.current = null;
  };

  // Compile list of snapshots in a selected cluster
  const getClusterSnapshots = (clusterId: number) => {
    const c = clusters.find(cl => cl.clusterId === clusterId);
    if (!c) return [];
    return [c.main, ...c.duplicates];
  };

  const handleSynthesizeCluster = async (clusterId: number) => {
    const snaps = getClusterSnapshots(clusterId);
    const ids = snaps.map(s => s.id);
    await onSynthesize(ids);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        
        {/* Canvas Area */}
        <div style={{ flex: '1 1 500px', position: 'relative' }}>
          <canvas
            ref={canvasRef}
            width={800}
            height={500}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            style={{
              width: '100%',
              height: '460px',
              background: 'linear-gradient(135deg, #09090b 0%, #18181b 100%)',
              borderRadius: '12px',
              border: '1px solid rgba(255, 255, 255, 0.05)',
              boxShadow: 'inset 0 4px 30px rgba(0, 0, 0, 0.8)',
              cursor: draggedNodeIdRef.current ? 'grabbing' : hoveredNode ? 'pointer' : 'default',
              display: 'block'
            }}
          />
          <div style={{
            position: 'absolute', bottom: 12, left: 12,
            background: 'rgba(0,0,0,0.6)', padding: '6px 12px',
            borderRadius: '6px', fontSize: '10px', color: '#9ca3af',
            border: '1px solid rgba(255,255,255,0.05)', backdropFilter: 'blur(4px)'
          }}>
            🖱️ اسحب العقد لتحريكها · انقر على أي عقدة لعرض تفاصيل التجميع والدمج
          </div>
        </div>

        {/* Control Panel / Detail View on the right */}
        <div style={{ flex: '1 1 250px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Card 
            title="💡 تفاصيل الترابط الدلالي" 
            className="ui-card--scrollable" 
            style={{ height: '460px' }}
          >
            {!selectedNode ? (
              <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--t3)', fontSize: '12px' }}>
                <div style={{ fontSize: '32px', marginBottom: '8px' }}>🕸️</div>
                انقر على أي عقدة دائرية في خريطة الترابط لعرض تفاصيلها ودراسة الفروق الدلالية وتوليف المقالات.
              </div>
            ) : selectedNode.type === 'cluster' && selectedNode.clusterId != null ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '14px', fontWeight: 'bold', color: 'var(--accent)' }}>مجموعة دلالية #{selectedNode.clusterId}</span>
                  <span style={{ fontSize: '11px', background: 'var(--accent-muted)', color: 'var(--accent)', padding: '2px 6px', borderRadius: '4px' }}>
                    {getClusterSnapshots(selectedNode.clusterId).length} مصادر متطابقة
                  </span>
                </div>
                
                <div style={{ fontSize: '12px', color: 'var(--t2)', borderTop: '1px solid var(--border)', paddingTop: '8px', lineHeight: '1.6' }}>
                  <strong>الملخص الدلالي المقارن:</strong>
                  <p style={{ marginTop: '4px', fontStyle: 'italic', background: 'rgba(255,255,255,0.02)', padding: '8px', borderRadius: '6px' }}>
                    {selectedNode.diffSummary}
                  </p>
                </div>

                <div style={{ fontSize: '11px', color: 'var(--t2)' }}>
                  <strong>المصادر المتطابقة في المجموعة:</strong>
                  <ul style={{ margin: '6px 0 0 0', paddingRight: '16px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {getClusterSnapshots(selectedNode.clusterId).map((snap, idx) => (
                      <li key={snap.id} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        [{idx + 1}] {snap.title}
                      </li>
                    ))}
                  </ul>
                </div>

                <Btn
                  variant="primary"
                  disabled={synthesizing}
                  onClick={() => handleSynthesizeCluster(selectedNode.clusterId!)}
                  style={{ width: '100%', marginTop: '6px' }}
                >
                  {synthesizing ? '⏳ جاري توليف الأخبار...' : '✨ دمج المجموعة وصياغة مقال'}
                </Btn>
              </div>
            ) : (
              // Selected Node is snapshot
              selectedNode.snapshot && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--fg)', lineHeight: '1.4' }}>
                    {selectedNode.snapshot.title}
                  </div>
                  {selectedNode.snapshot.summary && (
                    <div style={{ fontSize: '12px', color: 'var(--t2)', maxHeight: '150px', overflowY: 'auto', background: 'rgba(0,0,0,0.1)', padding: '6px', borderRadius: '6px' }}>
                      {selectedNode.snapshot.summary}
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '10px', color: 'var(--t3)', borderTop: '1px solid var(--border)', paddingTop: '8px' }}>
                    <span>تاريخ النشر/الرصد:</span>
                    <span>
                      {selectedNode.snapshot.published_at ? new Date(selectedNode.snapshot.published_at).toLocaleDateString() : new Date(selectedNode.snapshot.seen_at).toLocaleDateString()}
                    </span>
                  </div>
                  {selectedNode.snapshot.link && (
                    <a
                      href={selectedNode.snapshot.link}
                      target="_blank"
                      rel="noreferrer"
                      style={{ fontSize: '11px', color: 'var(--accent)', textDecoration: 'none', textAlign: 'center', display: 'block', marginTop: '4px' }}
                    >
                      🔗 فتح رابط المصدر بالمتصفح
                    </a>
                  )}
                </div>
              )
            )}
          </Card>
        </div>
        
      </div>
    </div>
  );
}
