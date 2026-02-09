import { Component, Input } from '@angular/core';
import { AsyncPipe, NgForOf } from '@angular/common';
import { EngineAnalysisService } from './engine-analysis.service';

@Component({
  selector: 'app-analysis-panel',
  standalone: true,
  imports: [AsyncPipe, NgForOf],
  templateUrl: './analysis-panel.component.html',
  styleUrl: './analysis-panel.component.css'
})
export class AnalysisPanelComponent {
  constructor(public readonly analysis: EngineAnalysisService) {}

  @Input() evalHistory: number[] = [];

  formatCount(value: number | null) {
    if (value == null) {
      return '--';
    }
    if (value >= 1_000_000) {
      return `${(value / 1_000_000).toFixed(1)}M`;
    }
    if (value >= 1_000) {
      return `${(value / 1_000).toFixed(1)}k`;
    }
    return `${value}`;
  }

  sparklinePoints() {
    if (!this.evalHistory.length) {
      return '';
    }
    const values = this.evalHistory.slice(-24);
    const maxPoints = values.length;
    const width = 220;
    const height = 60;
    const step = maxPoints > 1 ? width / (maxPoints - 1) : width;
    return values
      .map((value, index) => {
        const x = index * step;
        const y = this.evalToY(value, height);
        return `${x},${y}`;
      })
      .join(' ');
  }

  momentumBars() {
    return this.evalHistory.slice(-24);
  }

  barHeight(value: number) {
    const normalized = Math.min(1, Math.max(0, Math.abs(value) / 5));
    return 18 + normalized * 22;
  }

  barClass(value: number) {
    return value >= 0 ? 'pos' : 'neg';
  }

  lineScorePercent(score: string) {
    const parsed = this.scoreToNumber(score);
    if (parsed == null) {
      return 10;
    }
    const normalized = Math.min(1, Math.max(0, Math.abs(parsed) / 5));
    return 20 + normalized * 80;
  }

  private evalToY(value: number, height: number) {
    const clamped = Math.max(-5, Math.min(5, value));
    const normalized = (clamped + 5) / 10;
    return height - normalized * height;
  }

  private scoreToNumber(score: string) {
    if (!score) {
      return null;
    }
    const trimmed = String(score).trim();
    if (trimmed.startsWith('M')) {
      const mateValue = Number(trimmed.slice(1));
      if (Number.isNaN(mateValue)) {
        return null;
      }
      return mateValue > 0 ? 10 : -10;
    }
    const numeric = Number(trimmed);
    if (Number.isNaN(numeric)) {
      return null;
    }
    return numeric;
  }
}
