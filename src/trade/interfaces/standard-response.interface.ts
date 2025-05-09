export interface StandardResponse<T> {
    status: number;
    message: string;
    data: T | null;
} 