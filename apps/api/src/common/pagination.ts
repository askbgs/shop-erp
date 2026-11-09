import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class PageQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page: number = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200)
  pageSize: number = 50;

  /** Free-text search */
  @IsOptional() @IsString()
  q?: string;
}

export function paging(q: PageQuery) {
  return { skip: (q.page - 1) * q.pageSize, take: q.pageSize };
}

export function paged<T>(items: T[], total: number, q: PageQuery) {
  return { items, total, page: q.page, pageSize: q.pageSize };
}

/** Query-string boolean: only "true" / "1" are true ("false" stays false). */
export const QueryBool = () => Transform(({ value }) => value === true || value === 'true' || value === '1');
