import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

const isSensitiveQueryParam = (key: string) => {
  const normalized = key.toLowerCase().replace(/[^a-z]/g, '');
  return normalized === 'token' || normalized.endsWith('reconnecttoken');
};

@Component({
  selector: 'app-multiplayer-redirect',
  standalone: true,
  template: ''
})
export class MultiplayerRedirectComponent implements OnInit {
  constructor(private readonly route: ActivatedRoute, private readonly router: Router) {}

  ngOnInit() {
    const queryParams = Object.fromEntries(
      Object.entries(this.route.snapshot.queryParams)
        .filter(([key]) => !isSensitiveQueryParam(key))
    );

    void this.router.navigate(['/game'], {
      queryParams: { ...queryParams, mode: 'online' },
      replaceUrl: true
    });
  }
}
