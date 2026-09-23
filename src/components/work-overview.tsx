"use client";
type Task={id:string;title:string;assigneeId:string;assigneeIds?:string[];status:string;dueDate?:string;reviewState?:string;progress:number};
export default function WorkOverview({tasks,userId,users,onOpen,onChat,unread,workload=false}:{tasks:Task[];userId:string;users:{id:string;name:string;active:boolean}[];onOpen:(id:string)=>void;onChat:(id:string)=>void;unread:(id:string)=>number;workload?:boolean}){
 const today=new Date().toLocaleDateString('en-CA');
 const active=tasks.filter(t=>t.status!=='Completed');
 const assigned=(task:Task,id:string)=>(task.assigneeIds?.length?task.assigneeIds:[task.assigneeId]).includes(id);
 const groups=workload?users.filter(u=>u.active).map(u=>({name:u.name,items:active.filter(t=>assigned(t,u.id))})):[
 {name:'Overdue',items:active.filter(t=>assigned(t,userId)&&t.dueDate&&t.dueDate<today)},
 {name:'Due today',items:active.filter(t=>assigned(t,userId)&&t.dueDate===today)},
 {name:'Upcoming and unscheduled',items:active.filter(t=>assigned(t,userId)&&(!t.dueDate||t.dueDate>today))},
 {name:'Unread chats',items:tasks.filter(t=>unread(t.id)>0)}];
 return <section className="space-y-5"><h2 className="text-2xl font-bold">{workload?'Team workload':'My Work'}</h2><p className="text-sm text-slate-500">{workload?'Active tasks and subtasks per person. Counts reflect work you have permission to see, not estimated hours.':'Your deadlines and unread conversations in one place.'}</p><div className="grid gap-4 lg:grid-cols-2">{groups.map(group=><div key={group.name} className="rounded-xl border border-slate-200 bg-white p-4"><h3 className="font-bold">{group.name} <span className="text-indigo-600">({group.items.length})</span></h3>{!group.items.length&&<p className="mt-3 text-sm text-slate-500">No active items.</p>}<ul className="mt-3 divide-y divide-slate-100">{group.items.map(task=><li key={task.id} className="py-3"><button onClick={()=>group.name==='Unread chats'?onChat(task.id):onOpen(task.id)} className="block w-full break-words text-left font-semibold hover:text-indigo-600">{task.title}</button><p className="mt-1 text-xs text-slate-500">{task.status} · {task.progress}% · {task.dueDate?`Due ${task.dueDate}`:'No due date'}{task.reviewState==='pending'?' · Awaiting review':''}</p></li>)}</ul></div>)}</div></section>;
}

