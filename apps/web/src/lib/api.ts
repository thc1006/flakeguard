import { ApiResponse, PaginatedResponse } from '@flakeguard/shared';

const API_BASE_URL = process.env.NEXT_PUBLIC_FLAKEGUARD_API_URL || process.env.FLAKEGUARD_API_URL || 'http://localhost:3000';

class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public response?: any
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    
    const config: RequestInit = {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    };

    try {
      const response = await fetch(url, config);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new ApiError(
          errorData.message || `HTTP ${response.status}: ${response.statusText}`,
          response.status,
          errorData
        );
      }

      const data = await response.json();
      return data;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError(`Network error: ${error}`, 0);
    }
  }

  async get<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'GET' });
  }

  async post<T>(endpoint: string, data: any): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async put<T>(endpoint: string, data: any): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async delete<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'DELETE' });
  }

  // Repository endpoints
  async getRepositories(params?: {
    limit?: number;
    offset?: number;
    search?: string;
  }) {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.append('limit', params.limit.toString());
    if (params?.offset) searchParams.append('offset', params.offset.toString());
    if (params?.search) searchParams.append('search', params.search);
    
    const query = searchParams.toString();
    return this.get<PaginatedResponse<Repository>>(`/api/repositories${query ? `?${query}` : ''}`);
  }

  async getRepository(id: string) {
    return this.get<Repository>(`/api/repositories/${id}`);
  }

  // Quarantine endpoints
  async getQuarantinePlan(repositoryId: string, params?: {
    lookbackDays?: number;
    includeAnnotations?: boolean;
  }) {
    const searchParams = new URLSearchParams();
    if (params?.lookbackDays) searchParams.append('lookbackDays', params.lookbackDays.toString());
    if (params?.includeAnnotations !== undefined) searchParams.append('includeAnnotations', params.includeAnnotations.toString());
    
    const query = searchParams.toString();
    return this.get<QuarantinePlanResponse>(`/v1/quarantine/plan/${repositoryId}${query ? `?${query}` : ''}`);
  }

  // Task/Action endpoints
  async getTasks(params?: {
    limit?: number;
    offset?: number;
    type?: string;
    status?: string;
  }) {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.append('limit', params.limit.toString());
    if (params?.offset) searchParams.append('offset', params.offset.toString());
    if (params?.type) searchParams.append('type', params.type);
    if (params?.status) searchParams.append('status', params.status);
    
    const query = searchParams.toString();
    return this.get<PaginatedResponse<Task>>(`/api/tasks${query ? `?${query}` : ''}`);
  }

  // Health check
  async getHealth() {
    return this.get<HealthStatus>('/health/comprehensive');
  }
}

// Types for API responses
export interface Repository {
  id: string;
  name: string;
  fullName: string;
  owner: string;
  description?: string;
  defaultBranch: string;
  isPrivate: boolean;
  createdAt: string;
  updatedAt: string;
  health?: RepositoryHealth;
  metrics?: RepositoryMetrics;
}

export interface RepositoryHealth {
  status: 'excellent' | 'good' | 'warning' | 'critical';
  score: number;
  lastUpdated: string;
}

export interface RepositoryMetrics {
  totalTests: number;
  flakyTests: number;
  passingTests: number;
  failingTests: number;
  quarantinedTests: number;
  flakinessScore: number;
}

export interface QuarantinePlanResponse {
  success: boolean;
  data: {
    candidates: QuarantineCandidate[];
    summary: {
      totalCandidates: number;
      recommendedQuarantine: number;
      recommendedWarning: number;
    };
  };
}

export interface QuarantineCandidate {
  testName: string;
  testFullName: string;
  flakeScore: {
    score: number;
    confidence: number;
    recommendation: {
      action: 'none' | 'warn' | 'quarantine';
      reason: string;
      confidence: number;
    };
  };
}

export interface Task {
  id: string;
  type: string;
  status: string;
  metadata: Record<string, any>;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
}

export interface HealthStatus {
  status: string;
  timestamp: string;
  environment: string;
  version: string;
  components: Record<string, string>;
  features: Record<string, boolean>;
}

export const api = new ApiClient();
export { ApiError };
