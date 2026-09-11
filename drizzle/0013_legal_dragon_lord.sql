CREATE INDEX "agent_chat_message_thread_created_idx" ON "agent_chat_message" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_chat_thread_user_updated_idx" ON "agent_chat_thread" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "flow_runs_user_started_idx" ON "flow_runs" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "scheduled_actions_pending_action_idx" ON "scheduled_actions" USING btree ("user_id","pending_action_id");