import { Component, Input } from '@angular/core';
import { AsyncPipe, NgForOf, NgIf } from '@angular/common';
import { EngineAnalysisService } from './engine-analysis.service';

@Component({
  selector: 'app-analysis-panel',
  standalone: true,
  imports: [AsyncPipe, NgForOf, NgIf],
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

  private evalToY(value: number, height: number) {
    const clamped = Math.max(-5, Math.min(5, value));
    const normalized = (clamped + 5) / 10;
    return height - normalized * height;
  }

}
