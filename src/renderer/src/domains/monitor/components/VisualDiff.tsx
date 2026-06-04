import { useState, useMemo } from 'react';
import { Btn } from '../../../ui';

interface VisualDiffProps {
  oldText: string;
  newText: string;
}

interface DiffLine {
  type: 'added' | 'removed' | 'unchanged';
  text: string;
}

export function VisualDiff({ oldText, newText }: VisualDiffProps) {
  const [viewMode, setViewMode] = useState<'side-by-side' | 'inline'>('side-by-side');

  // Compute the Longest Common Subsequence line diff
  const diffLines = useMemo(() => {
    const oldLines = oldText.split('\n').map(l => l.trimEnd());
    const newLines = newText.split('\n').map(l => l.trimEnd());

    // Simple LCS dynamic programming table
    const dp: number[][] = Array(oldLines.length + 1)
      .fill(0)
      .map(() => Array(newLines.length + 1).fill(0));

    for (let i = 1; i <= oldLines.length; i++) {
      for (let j = 1; j <= newLines.length; j++) {
        if (oldLines[i - 1] === newLines[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }

    const result: DiffLine[] = [];
    let i = oldLines.length;
    let j = newLines.length;

    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
        result.unshift({ type: 'unchanged', text: oldLines[i - 1] });
        i--;
        j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        result.unshift({ type: 'added', text: newLines[j - 1] });
        j--;
      } else {
        result.unshift({ type: 'removed', text: oldLines[i - 1] });
        i--;
      }
    }

    return result;
  }, [oldText, newText]);

  // Aligned rows for side-by-side view (matching left and right columns)
  const alignedRows = useMemo(() => {
    const rows: { left?: DiffLine; right?: DiffLine }[] = [];
    
    // We walk through the diff list and pair removals with additions where possible
    let idx = 0;
    while (idx < diffLines.length) {
      const line = diffLines[idx];
      
      if (line.type === 'unchanged') {
        rows.push({ left: line, right: line });
        idx++;
      } else if (line.type === 'removed') {
        // Look ahead to see if the next line is an addition to align them side-by-side
        const next = diffLines[idx + 1];
        if (next && next.type === 'added') {
          rows.push({ left: line, right: next });
          idx += 2;
        } else {
          rows.push({ left: line });
          idx++;
        }
      } else {
        // line is an addition
        rows.push({ right: line });
        idx++;
      }
    }
    
    return rows;
  }, [diffLines]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
      {/* Toggle View Mode Toolbar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg2)', padding: '6px 12px', borderRadius: '8px', border: '1px solid var(--border)' }}>
        <span style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--t1)' }}>📋 مقارنة التعديلات البصرية للموقع</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <Btn 
            onClick={() => setViewMode('side-by-side')}
            variant={viewMode === 'side-by-side' ? 'primary' : 'ghost'}
            style={{ fontSize: '11px', padding: '3px 8px' }}
          >
            💻 جنباً إلى جنب
          </Btn>
          <Btn 
            onClick={() => setViewMode('inline')}
            variant={viewMode === 'inline' ? 'primary' : 'ghost'}
            style={{ fontSize: '11px', padding: '3px 8px' }}
          >
            🔀 مقارنة متداخلة
          </Btn>
        </div>
      </div>

      {/* Diff Table View */}
      <div style={{ 
        width: '100%', 
        maxHeight: '400px', 
        overflowY: 'auto', 
        borderRadius: '8px', 
        border: '1px solid var(--border)', 
        background: '#09090b',
        fontFamily: 'Consolas, Monaco, monospace', 
        fontSize: '11.5px',
        lineHeight: '1.6'
      }}>
        {viewMode === 'side-by-side' ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', width: '100%', minWidth: '600px' }}>
            
            {/* Left Column (Deletions) */}
            <div style={{ borderInlineEnd: '1px solid rgba(255, 255, 255, 0.05)', padding: '8px 0' }}>
              <div style={{ padding: '0 12px 6px 12px', borderBottom: '1px solid rgba(255, 255, 255, 0.05)', color: '#ef4444', fontWeight: 'bold', fontSize: '10px' }}>
                🔴 النسخة السابقة (المحذوفة)
              </div>
              {alignedRows.map((row, idx) => (
                <div 
                  key={`left-${idx}`} 
                  style={{ 
                    whiteSpace: 'pre-wrap', 
                    padding: '1px 12px',
                    background: row.left?.type === 'removed' ? 'rgba(239, 68, 68, 0.12)' : 'transparent',
                    color: row.left?.type === 'removed' ? '#f87171' : '#9ca3af',
                    minHeight: '20px'
                  }}
                >
                  {row.left ? (row.left.type === 'removed' ? `- ${row.left.text}` : `  ${row.left.text}`) : ''}
                </div>
              ))}
            </div>

            {/* Right Column (Additions) */}
            <div style={{ padding: '8px 0' }}>
              <div style={{ padding: '0 12px 6px 12px', borderBottom: '1px solid rgba(255, 255, 255, 0.05)', color: '#10b981', fontWeight: 'bold', fontSize: '10px' }}>
                🟢 النسخة الحالية (المضافة)
              </div>
              {alignedRows.map((row, idx) => (
                <div 
                  key={`right-${idx}`} 
                  style={{ 
                    whiteSpace: 'pre-wrap', 
                    padding: '1px 12px',
                    background: row.right?.type === 'added' ? 'rgba(16, 185, 129, 0.12)' : 'transparent',
                    color: row.right?.type === 'added' ? '#34d399' : '#e2e8f0',
                    minHeight: '20px'
                  }}
                >
                  {row.right ? (row.right.type === 'added' ? `+ ${row.right.text}` : `  ${row.right.text}`) : ''}
                </div>
              ))}
            </div>

          </div>
        ) : (
          // Inline Mode
          <div style={{ padding: '8px 0', minWidth: '300px' }}>
            {diffLines.map((line, idx) => (
              <div 
                key={`inline-${idx}`} 
                style={{ 
                  whiteSpace: 'pre-wrap', 
                  padding: '1px 12px',
                  background: line.type === 'added' 
                    ? 'rgba(16, 185, 129, 0.12)' 
                    : line.type === 'removed' 
                    ? 'rgba(239, 68, 68, 0.12)' 
                    : 'transparent',
                  color: line.type === 'added' 
                    ? '#34d399' 
                    : line.type === 'removed' 
                    ? '#f87171' 
                    : '#e2e8f0',
                  minHeight: '20px'
                }}
              >
                {line.type === 'added' ? `+ ${line.text}` : line.type === 'removed' ? `- ${line.text}` : `  ${line.text}`}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
