import {handleFlight} from '../server/service.mjs';

export default {
  fetch(request,env) {
    if(!new URL(request.url).pathname.startsWith('/api/flight/'))return Response.json({error:{code:'NOT_FOUND',message:'接口不存在。'}},{status:404});
    return handleFlight(request,env.DB);
  }
};
