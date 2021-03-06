import {
    CallHandler,
    ExecutionContext,
    Injectable,
    NestInterceptor,
  } from '@nestjs/common';
  import { Observable, throwError } from 'rxjs';
  import { tap, catchError, map } from 'rxjs/operators';
import { IncomingMessage } from 'http';
import { WinstonLogger } from '@payk/nestjs-winston';
import * as maskJson from 'mask-json';
  
  @Injectable()
  export class LoggingInterceptor implements NestInterceptor {
    private readonly logger = new WinstonLogger(LoggingInterceptor.name);
    private readonly jsonMasker = (x: any) => x;
    /**
     *
     */
    constructor(private readonly maskedFields?: string[]) {
      if  (maskedFields) {
        this.jsonMasker = maskJson(maskedFields);
      }
    }

    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
      if (context.getType() === 'http') {
        return this.handleHttp(context, next);
      }
      else if (context.getType() === 'rpc') {
        return this.handleZeebe(context, next);
      }
    }

    handleHttp(context: ExecutionContext, next: CallHandler): Observable<any> {
      const { body, params, query, headers, method, url, route } = context.getArgs().find((a) => a instanceof IncomingMessage )
        this.logger.info(`Request: To path: ${route.path} (${url}) with method ${method}`,  this.jsonMasker({ body, params: params, query, headers, method, url, path: route.path }) )
  
        return next
          .handle()
          .pipe(tap((response) =>  {
            let httpResponse = context.switchToHttp().getResponse();
            this.logger.info(`Response: To path: ${route.path} (${url}) with method ${method}, status code: ${httpResponse.statusCode}`, this.jsonMasker({ response: { headers: httpResponse.getHeaders(), statusCode: httpResponse.statusCode, body: response }, request: { body, params, query, headers, method, url, path: route.path }}))
          })).pipe(catchError((err) => {
            let httpResponse = context.switchToHttp().getResponse();
            let statusCode = err?.status;
            this.logger.error(`Error Response: To path: ${route.path} (${url}) with method ${method}, status code: ${statusCode ?? httpResponse.statusCode}`, this.jsonMasker({ response: { headers: httpResponse.getHeaders(), statusCode: httpResponse.statusCode, error: err }, request: { body, params, query, headers, method, url, path: route.path }}))
            return throwError(err)
          }));
    }

    handleZeebe(context: ExecutionContext, next: CallHandler): any {
      const rpcContext = context.switchToRpc();
      const data = rpcContext.getData();

      this.logger.info(`Request: Of type: ${data.type} with process id ${data.bpmnProcessId} `, this.jsonMasker({ ...data }));
      let nextHn = next.handle();
      let n2 = nextHn.pipe(catchError((err) => {
        this.logger.error(`Error Response: Of type: ${data.type} with process id ${data.bpmnProcessId} `, this.jsonMasker({ request: data, error: err }));
        return throwError(err);
      })).toPromise().then((res) => {
          this.logger.info(`Response: Of type: ${data.type} with process id ${data.bpmnProcessId} `, this.jsonMasker({ request: data, response: res }));
          return res;
      }).catch((err) => {
        throw err;
      });

      return n2;
    }
  }