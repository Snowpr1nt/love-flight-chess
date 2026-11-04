(function(root){
  'use strict';
  const transportCodes=new Set(['OFFLINE','TIMEOUT','SERVICE_UNREACHABLE','ACCESS_BLOCKED','SERVICE_UNAVAILABLE','INVALID_RESPONSE']);
  class FlightError extends Error {
    constructor(code,message,status){super(message);this.name='FlightError';this.code=code;if(status)this.status=status;}
  }
  async function requestJSON(url,init={},options={}) {
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),options.timeoutMs??12000);
    const isOnline=()=>options.isOnline?options.isOnline():root.navigator?.onLine!==false;
    try {
      const response=await (options.fetchImpl||root.fetch)(url,{...init,signal:controller.signal});
      // Edge/WAF/proxy HTML is not an application response, even if HTTP is 200.
      const text=await response.text();let data;
      try{data=JSON.parse(text);}catch{
        if(response.status===403)throw new FlightError('ACCESS_BLOCKED','联机服务拒绝了访问，请联系维护者或先使用同屏试玩。',403);
        if(response.status>=500)throw new FlightError('SERVICE_UNAVAILABLE','联机服务暂时不可用，请稍后重试或先使用同屏试玩。',response.status);
        throw new FlightError('INVALID_RESPONSE','联机服务返回异常，暂时无法确认刚才的操作是否成功。',response.ok?undefined:response.status);
      }
      if(!response.ok)throw new FlightError(data?.error?.code||'SERVICE_UNAVAILABLE',data?.error?.message||'联机服务暂时不可用，请稍后重试。',response.status);
      if(!data||typeof data!=='object'||Array.isArray(data))throw new FlightError('INVALID_RESPONSE','联机服务返回异常，暂时无法确认刚才的操作是否成功。');
      return data;
    }catch(error){
      if(error instanceof FlightError)throw error;
      if(error.name==='AbortError'||controller.signal.aborted)throw new FlightError('TIMEOUT','联机服务响应超时，刚才的操作尚未确认。请重新连接。');
      if(error instanceof TypeError){
        if(!isOnline())throw new FlightError('OFFLINE','设备当前处于离线状态，请恢复连接后重试。');
        // Browsers deliberately hide status/HTML when CORS or a preflight fails.
        throw new FlightError('SERVICE_UNREACHABLE','暂时无法连接联机服务，可能是服务访问限制或连接异常。请重试或先使用同屏试玩。');
      }
      throw error;
    }finally{clearTimeout(timer);}
  }
  const api={requestJSON,isConnectionError:error=>transportCodes.has(error?.code)||error?.status>=500};
  root.CoupleFlightNetwork=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
